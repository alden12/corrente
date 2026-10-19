/**
 * Dev/test-only e2e harness for the offline renderer (AGENT-4.1, "agent ears").
 *
 * The offline-render paths (worklet instruments, sampler pre-decode, audio tracks, MIDI devices)
 * can only be proven in a real browser - jsdom (the vitest env) has no AudioWorklet - so their
 * coverage is the Playwright suite in `e2e/offline-render.e2e.ts`. Playwright reaches into the app
 * through `page.evaluate`, which runs in the browser's global scope and can only see what is on
 * `window`. This module bridges that gap: it builds minimal projects, renders them, and exposes the
 * results as `window.__daw*` hooks the e2e calls.
 *
 * `installRenderHarness` is invoked from `main.tsx` behind an `import.meta.env` guard, so the whole
 * module is dead-code-eliminated from production builds and never ships.
 */
import { renderProjectOffline, analyzeProjectMix, peakAmplitude } from "../audio/engine/renderOffline";
import { ProjectStore, type Track } from "../audio/project/projectStore";
import { encodeWav } from "../audio/recording/wav";
import { putAudio } from "../audio/audioStore";
import { renderProject } from "../audio/render/renderProject";
import { fetchEngine } from "../audio/bank/pool";
import { browserAudio, browserSample } from "../audio/bank/deviceSamples";
import { spectrumOf } from "../audio/analysis/spectrum";

interface RenderHarness {
  __dawRenderProjectSmoke?: () => Promise<number>;
  __dawRenderSamplerSmoke?: () => Promise<number>;
  __dawRenderAudioTrackSmoke?: () => Promise<number>;
  __dawRenderMidiDeviceSmoke?: () => Promise<number>;
  __dawAnalyzeMix?: () => Promise<unknown>;
  __dawRenderBothWays?: (name: string) => Promise<{ offline: BandLevels; core: BandLevels }>;
}

/** A render's level by octave band, and overall, in dB: what the two renders are compared by. */
interface BandLevels {
  bands: number[];
  rms: number;
}

// Build a tiny project (the seeded default instrument track + a wavetable/worklet track), put a
// note on each - exercises the whole project-consuming render path.
const buildSmokeProject = (): ProjectStore => {
  const project = new ProjectStore();
  project.addTrack("wavetable");
  for (const track of project.getTracks()) {
    if (track.kind === "instrument") track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
  }
  return project;
};

// A sampler track (default sample: builtin:kick) - proves samples are decoded (Instrument.ready)
// before render, so they are not silent.
const buildSamplerProject = (): ProjectStore => {
  const project = new ProjectStore(false);
  const track = project.addTrack("sampler");
  if (track.kind === "instrument") track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
  return project;
};

// An audio track backed by a synthetic recorded take (a 220 Hz sine stored via putAudio) - proves
// audio-clip buffers are decoded + scheduled offline, not just instrument tracks.
const buildAudioTrackProject = async (): Promise<ProjectStore> => {
  const sampleRate = 44100;
  const durationSec = 0.5;
  const samples = new Float32Array(Math.floor(sampleRate * durationSec));
  for (let i = 0; i < samples.length; i += 1) samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  const fileId = await putAudio(encodeWav(samples, sampleRate));
  const project = new ProjectStore(false);
  project.addAudioTrack({ fileId, name: "Take", durationSec, startBeat: 0 });
  return project;
};

// An instrument track with a MIDI device (octavator) + a note - proves notes route through the
// device chain (via the offline transport clock) into the instrument, not silence.
const buildMidiDeviceProject = (): ProjectStore => {
  const project = new ProjectStore();
  const track = project.getTracks().find((entry) => entry.kind === "instrument");
  if (track?.kind === "instrument") {
    project.addMidiDevice(track.id, "octavator");
    track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
  }
  return project;
};

/**
 * Projects to render both ways, building up the mix a piece at a time, so a difference has a place.
 * One note each, held to the end: the browser's offline render loses every engine note event after
 * the first (INST-49), so a chord, a note-off or a second track would compare that bug, not the mix.
 */
const MIX_PROJECTS: Record<string, (project: ProjectStore) => void | Promise<void>> = {
  synth: (project) => notes(project.addTrack("subtractive"), [60], 0.5),
  bass: (project) => notes(project.addTrack("fm"), [36], 0.8),
  "track effect": (project) => {
    const bass = project.addTrack("fm");
    project.addEffect(bass.id, "distortion");
    project.setVolume(bass.id, 0.6);
    notes(bass, [36], 0.8);
  },
  "group effect": (project) => {
    const keys = project.addTrack("subtractive");
    project.addEffect(keys.parentId!, "reverb");
    notes(keys, [60], 0.5);
  },
  // A take at 44.1 kHz, so the core's resampling meets the browser's decoder, through an effect.
  "audio clip": async (project) => {
    const track = project.addAudioTrack({ fileId: await takeAt(44100, 1), durationSec: 1, length: MIX_BEATS });
    project.addEffect(track.id, "distortion");
  },
};

/** A take of a 220 Hz sine at half scale, stored as a project's recordings are; its file id. */
const takeAt = (sampleRate: number, durationSec: number) =>
  putAudio(
    encodeWav(
      Float32Array.from(
        { length: Math.floor(sampleRate * durationSec) },
        (_, frame) => 0.5 * Math.sin((2 * Math.PI * 220 * frame) / sampleRate),
      ),
      sampleRate,
    ),
  );

const MIX_BEATS = 8;

/** Notes held from the start to the end of the project. */
const notes = (track: Track, pitches: number[], velocity: number) => {
  if (track.kind === "instrument")
    pitches.forEach((pitch) => track.clips[0].store.addNote({ pitch, start: 0, length: MIX_BEATS, velocity }));
};

const mixProject = async (name: string): Promise<ProjectStore> => {
  const project = new ProjectStore(false);
  project.setTempo(120);
  project.setLength(MIX_BEATS);
  await MIX_PROJECTS[name](project);
  return project;
};

const levelsOf = (samples: Float32Array, sampleRate: number): BandLevels => {
  const spectrum = spectrumOf(samples, sampleRate);
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  return { bands: spectrum.bands.map((band) => band.db), rms: 20 * Math.log10(rms) };
};

/** Install the offline-render e2e hooks onto `window`. Called from main.tsx in dev/test only. */
export function installRenderHarness(): void {
  const harness = window as unknown as RenderHarness;
  harness.__dawRenderProjectSmoke = async () => peakAmplitude(await renderProjectOffline(buildSmokeProject()));
  harness.__dawRenderSamplerSmoke = async () => peakAmplitude(await renderProjectOffline(buildSamplerProject()));
  harness.__dawRenderAudioTrackSmoke = async () =>
    peakAmplitude(await renderProjectOffline(await buildAudioTrackProject()));
  harness.__dawRenderMidiDeviceSmoke = async () => peakAmplitude(await renderProjectOffline(buildMidiDeviceProject()));
  // The full "agent ears" chain: render offline -> analyze -> model-friendly report.
  harness.__dawAnalyzeMix = async () => analyzeProjectMix(buildSmokeProject());
  // The same project through the browser's offline render and through the engine render core.
  harness.__dawRenderBothWays = async (name) => {
    const sampleRate = 48000;
    const project = await mixProject(name);
    const offline = await renderProjectOffline(project, { sampleRate, tailSec: 0 });
    const decoder = new OfflineAudioContext(1, 1, sampleRate);
    const core = await renderProject(
      project,
      {
        engine: await fetchEngine(),
        loadSample: browserSample(decoder),
        loadAudio: browserAudio(decoder),
        sampleRate,
      },
      { tailSec: 0 },
    );
    return {
      offline: levelsOf(offline.getChannelData(0), sampleRate),
      core: levelsOf(core.channels[0], sampleRate),
    };
  };
}
