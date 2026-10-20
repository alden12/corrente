/**
 * Dev/test-only e2e harness for rendering a project in the browser (AGENT-4.9 part 3b).
 *
 * The render worker can only be proven in a real browser, so its coverage is the Playwright suite in
 * `e2e/offline-render.e2e.ts`. Playwright reaches into the app through `page.evaluate`, which runs
 * in the browser's global scope and can only see what is on `window`. This module bridges that gap:
 * it builds small projects, renders them, and exposes the results as `window.__daw*` hooks the e2e
 * calls.
 *
 * `installRenderHarness` is invoked from `main.tsx` behind an `import.meta.env` guard, so the whole
 * module is dead-code-eliminated from production builds and never ships.
 */
import { analyzeProjectMix, renderProjectInWorker } from "../audio/engine/renderInWorker";
import { ProjectStore, type Track } from "../audio/project/projectStore";
import { encodeWav } from "../audio/recording/wav";
import { putAudio } from "../audio/audioStore";
import { renderProject } from "../audio/render/renderProject";
import { fetchEngine } from "../audio/bank/pool";
import { browserAudio, browserSample } from "../audio/bank/deviceSamples";

/** How a project rendered in the worker compares with the same render on the page. */
export interface PlacesCompared {
  /** The worker's loudest sample. */
  peak: number;
  /** The largest difference between the two, sample by sample. */
  difference: number;
  omitted: string[];
}

interface RenderHarness {
  __dawAnalyzeMix?: () => Promise<unknown>;
  __dawRenderBothPlaces?: (name: string) => Promise<PlacesCompared>;
}

const MIX_BEATS = 8;

/** Notes from `start` (beats) to the end of the project. */
const notes = (track: Track, pitches: number[], velocity: number, start = 0) => {
  if (track.kind === "instrument")
    pitches.forEach((pitch) => track.clips[0].store.addNote({ pitch, start, length: MIX_BEATS - start, velocity }));
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

/** Projects to render, each with a piece of the mix that has to make it across to the worker. */
const MIX_PROJECTS: Record<string, (project: ProjectStore) => void | Promise<void>> = {
  // A chord and a bass that comes in later: several notes and tracks, starting and stopping (INST-49).
  "chord and bass": (project) => {
    notes(project.addTrack("subtractive"), [60, 64, 67], 0.5);
    notes(project.addTrack("fm"), [36], 0.8, 2);
  },
  // A sample the page decodes and hands over.
  sampler: (project) => notes(project.addTrack("sampler"), [60], 0.9),
  "track and group effects": (project) => {
    const bass = project.addTrack("fm");
    project.addEffect(bass.id, "distortion");
    project.addEffect(bass.parentId!, "reverb");
    notes(bass, [36], 0.8);
  },
  "MIDI device": (project) => {
    const keys = project.addTrack("subtractive");
    project.addMidiDevice(keys.id, "arpeggiator");
    notes(keys, [60, 64, 67], 0.7);
  },
  // A recorded take at 44.1 kHz, which the page decodes at the render's rate.
  "audio clip": async (project) => {
    const track = project.addAudioTrack({ fileId: await takeAt(44100, 1), durationSec: 1, length: MIX_BEATS });
    project.addEffect(track.id, "distortion");
  },
};

const mixProject = async (name: string): Promise<ProjectStore> => {
  const project = new ProjectStore(false);
  project.setTempo(120);
  project.setLength(MIX_BEATS);
  await MIX_PROJECTS[name](project);
  return project;
};

/** Install the render e2e hooks onto `window`. Called from main.tsx in dev/test only. */
export function installRenderHarness(): void {
  const harness = window as unknown as RenderHarness;
  // The full "agent ears" chain: render in the worker -> analyze -> model-friendly report.
  harness.__dawAnalyzeMix = async () => (await analyzeProjectMix(await mixProject("chord and bass"))).summary;
  // The same project rendered in the worker and on the page: the worker has to hear what the core does.
  harness.__dawRenderBothPlaces = async (name) => {
    const sampleRate = 48000;
    const project = await mixProject(name);
    const worker = await renderProjectInWorker(project, { sampleRate, tailSec: 1 });
    const decoder = new OfflineAudioContext(1, 1, sampleRate);
    const page = await renderProject(
      project,
      { engine: await fetchEngine(), loadSample: browserSample(decoder), loadAudio: browserAudio(decoder), sampleRate },
      { tailSec: 1 },
    );
    const largest = (values: ArrayLike<number>) => Array.from(values).reduce((most, value) => Math.max(most, value), 0);
    return {
      peak: largest(worker.channels.map((channel) => largest(channel.map(Math.abs)))),
      difference: largest(
        worker.channels.map((channel, index) =>
          largest(channel.map((sample, frame) => Math.abs(sample - page.channels[index][frame]))),
        ),
      ),
      omitted: worker.omitted,
    };
  };
}
