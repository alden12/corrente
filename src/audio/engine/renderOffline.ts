/**
 * Offline render (AGENT-4.1, "agent ears").
 *
 * Renders the project to an AudioBuffer under an `OfflineAudioContext`, reusing the EXACT DSP
 * the user hears (the same instrument/effect factories + worklets), so the agent can analyze
 * the mix (LUFS / spectral / clipping) without a second engine to keep in sync. The factories
 * take a `BaseAudioContext`, so an `OfflineAudioContext` is passed directly (no cast).
 *
 * It can only be exercised in a real browser (jsdom has no AudioWorklet), so its coverage is the
 * offline-render e2e. The engine render core (AGENT-4.9, `render/`) is replacing it.
 */
import { groupDepth, groupEffectStage, trackEffectStage } from "../bank/stages";
import type { MixNode } from "./latency";
import { MixRouter, masterBus } from "./mixer";
import { ChainEffects } from "./chainEffects";
import { trackInstrument } from "./trackInstrument";
import { loadWorklets } from "../worklets";
import { setTransport as setEngineTransport } from "../bank/pool";
import { setSampleAssets } from "../samples/sampleRegistry";
import { soloMutedTrackIds } from "./mix";
import { beatsToSeconds } from "../sequencer/scheduler";
import { audioTriggers, trackNotes } from "../render/trackNotes";
import { getAudioBuffer } from "../audioStore";
import { audioPlayWindow } from "./audioWindow";
import { midiChain } from "../midi/device/registry";
import { analyzeMix, summarizeMix, type MixSummary } from "../analysis/analyze";
import type { ProjectStore, EffectInstance, InstrumentTrack, AudioTrack } from "../project/projectStore";
import type { AudioClipData } from "../project/types";
import type { Instrument } from "../instruments/types";
import type { TransportClock } from "../midi/device/clock";

export interface RenderOptions {
  /** Render sample rate. Default 44100. */
  sampleRate?: number;
  /** Seconds rendered after the arrangement ends, so reverb/delay tails are captured. Default 2. */
  tailSec?: number;
}

/**
 * Render a project's arrangement to an AudioBuffer under an OfflineAudioContext, reusing the
 * exact instrument/effect factories the live engine uses (the "same DSP" thesis). The graph
 * mirrors AudioEngine.reconcile: instrument -> effects -> track gain -> group bus(es) -> master
 * -> soft clip -> destination. Notes are flattened from placements and scheduled up front inside a
 * single suspend(0), so worklet-instrument port messages are queued before the first block.
 *
 * Fidelity (AGENT-4.7): the output matches live playback - async assets (sampler/drumkit +
 * audio-clip buffers) are decoded before rendering, groove is applied, audio tracks render their
 * clips, and notes route through each track's MIDI-device chain (arp / octavator) via an offline
 * transport clock. The region plays once, which IS the arrangement (live just loops it).
 */
export async function renderProjectOffline(project: ProjectStore, options: RenderOptions = {}): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const tailSec = options.tailSec ?? 2;
  const bpm = project.tempo;
  const loopStart = project.loopStart;
  const regionBeats = Math.max(0, project.length - loopStart);
  const durationSec = beatsToSeconds(regionBeats, bpm) + tailSec;
  const frames = Math.max(1, Math.ceil(durationSec * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  // The notes' timeline: tempo, region, and the groove the live scheduler nudges each note by.
  const timeline = { tempo: bpm, loopStart, length: project.length, groove: project.getGroove() };
  // The transport clock MIDI devices read, as a pure function of the render timeline: render time 0
  // maps to beat loopStart, so continuousBeatAtTime(t) = loopStart + t*bps. `playing` is always true
  // (we are bouncing the arrangement), so generators (arp) lock to the grid exactly as they do live.
  const bps = bpm / 60;
  const transportClock: TransportClock = {
    playing: true,
    get currentTime() {
      return ctx.currentTime;
    },
    secondsPerBeat: 60 / bpm,
    continuousBeatAtTime: (time) => loopStart + time * bps,
  };

  await loadWorklets(ctx);
  // The new engine's host signals follow the same timeline (INST-36.4).
  setEngineTransport(ctx, { time: 0, beat: loopStart, tempo: bpm, playing: true });
  setSampleAssets(project.getSamples()); // so a Sampler's "asset:<id>" ref resolves

  // Master bus and soft clip, as the live engine has (mixer.ts).
  const master = masterBus(ctx);

  const groups = project.getGroups();
  const tracks = project.getTracks();
  const mutedTracks = soloMutedTrackIds(groups, tracks);
  const disposables: { dispose(): void }[] = [];

  // Build every group bus first (a child may route into a parent created this pass), then wire.
  const groupInputs = new Map<string, GainNode>();
  const groupOutputs = groups.map((group) => {
    const input = ctx.createGain();
    groupInputs.set(group.id, input);
    return { group, input, output: ctx.createGain() };
  });
  // Each track and group goes to its parent through a delay making up for what's later beside it
  // (INST-36.7), as in AudioEngine; set once every chain is built.
  const router = new MixRouter(ctx, (parentId) => (parentId ? groupInputs.get(parentId) : undefined) ?? master);
  const mixTracks: MixNode[] = [];
  const mixGroups: MixNode[] = [];
  const route = (into: MixNode[], from: AudioNode, node: MixNode) => {
    router.route(node.id, from, node.parentId);
    into.push(node);
  };
  // Effect chains built as AudioEngine builds them (ChainEffects, INST-36.7).
  const chains: ChainEffects[] = [];
  const chainOf = (
    input: AudioNode,
    effects: EffectInstance[],
    output: AudioNode,
    stageAt: (index: number) => number = trackEffectStage,
  ) => {
    const chain = new ChainEffects();
    chain.reconcile(ctx, effects, new Set(), stageAt);
    chain.wire(input, output);
    chains.push(chain);
    return chain;
  };
  for (const { group, input, output } of groupOutputs) {
    const depth = groupDepth(groups, group.id);
    const chain = chainOf(input, group.effects, output, (index) => groupEffectStage(depth, index));
    route(mixGroups, output, { id: group.id, parentId: group.parentId, latency: chain.latency() });
    output.gain.value = group.muted ? 0 : group.volume;
  }

  // Tracks: build each track's chain and route it into the group tree, and collect the scheduling
  // closures (run later, inside suspend, so worklet note messages are queued in time).
  const scheduleFns: (() => void)[] = [];
  const instruments: Instrument[] = [];
  const audioBuffers = new Map<string, AudioBuffer>();
  for (const track of tracks) {
    if (track.kind === "instrument") {
      const gain = ctx.createGain();
      const { instrument, absorbed } = trackInstrument(ctx, track.instrumentType, track.params, track.effects);
      instruments.push(instrument);
      disposables.push(instrument);
      const chain = chainOf(instrument.output, track.effects.slice(absorbed.length), gain);
      route(mixTracks, gain, {
        id: track.id,
        parentId: track.parentId,
        latency: (instrument.latency ?? 0) + chain.latency(),
      });
      gain.gain.value = mutedTracks.has(track.id) ? 0 : track.volume;

      // MIDI-device note chain (d0 -> ... -> instrument); notes enter at the head. The device
      // strategy self-schedules all transformed notes from one playNote using the transport clock,
      // so an arp / octavator renders faithfully offline. No devices => head IS the instrument.
      const { head: noteHead, devices } = midiChain(track.midiDevices, instrument, transportClock);
      disposables.push(...devices);

      const notes = trackNotes(track, timeline);
      scheduleFns.push(() =>
        notes.forEach((note) => noteHead.playNote(note.pitch, note.length, note.velocity, note.start)),
      );
    } else {
      // Audio track: input -> effects -> gain -> group tree; its clips are scheduled below.
      const input = ctx.createGain();
      const gain = ctx.createGain();
      const chain = chainOf(input, track.effects, gain);
      route(mixTracks, gain, { id: track.id, parentId: track.parentId, latency: chain.latency() });
      gain.gain.value = mutedTracks.has(track.id) ? 0 : track.volume;
      scheduleFns.push(() =>
        audioTriggers(track, timeline).forEach(({ clip, start, maxSec }) => {
          const buffer = audioBuffers.get(clip.fileId);
          if (buffer) scheduleAudioClipOffline(ctx, buffer, clip, input, start, maxSec);
        }),
      );
    }
  }

  router.compensate(mixTracks, mixGroups);

  // Decode audio-clip buffers + wait for instrument assets (sampler/drumkit buffers) before
  // rendering - offline render runs to completion immediately, so anything undecoded renders silent.
  disposables.push(...chains);
  const effects = chains.flatMap((chain) => chain.effects());
  await Promise.all([...instruments, ...effects].map((device) => device.ready?.()));
  await decodeAudioClips(ctx, tracks, audioBuffers);

  // Schedule all notes inside one suspend(0): a worklet note is a port message, and a message
  // posted before startRendering() races the offline render and loses. Pausing at t=0 lets the
  // messages queue before the first block; the processors dispatch each note at its own `when`.
  void ctx.suspend(0).then(() => {
    for (const run of scheduleFns) run();
    void ctx.resume();
  });

  const buffer = await ctx.startRendering();
  // Instruments/effects subscribe to their ParamStore (bindParams); unsubscribe so a discarded
  // render never keeps reacting to the live project's params.
  for (const disposable of disposables) disposable.dispose();
  return buffer;
}

/**
 * Render the project offline and measure its master output - the agent's "ears" as one call.
 * This is what the `analyze_mix` tool runs: it hears the exact audio the user would, so the
 * agent can check its edits (clipping / level / loudness) instead of reasoning blind.
 */
export async function analyzeProjectMix(project: ProjectStore): Promise<MixSummary> {
  return summarizeMix(analyzeMix(await renderProjectOffline(project)));
}

/** Decode every audio-clip file the project references into `audioBuffers` (keyed by fileId). A
 *  missing/undecodable file is skipped (it renders as silence, exactly as the live engine does). */
async function decodeAudioClips(
  ctx: BaseAudioContext,
  tracks: readonly { kind: string }[],
  audioBuffers: Map<string, AudioBuffer>,
): Promise<void> {
  const clips = (tracks as (InstrumentTrack | AudioTrack)[]).flatMap((track) =>
    track.kind === "audio" ? track.clips : [],
  );
  await Promise.all(
    clips.map(async (clip) => {
      if (audioBuffers.has(clip.fileId)) return;
      try {
        audioBuffers.set(clip.fileId, await ctx.decodeAudioData(await getAudioBuffer(clip.fileId)));
      } catch {
        // Missing file / decode failure - leave it out; that clip renders silent (matches live).
      }
    }),
  );
}

/** Play one audio-clip trigger: its loop-region slice of the buffer at `when`, into `dest`. Mirrors
 *  AudioEngine.scheduleAudioClip (minus the live source bookkeeping). */
function scheduleAudioClipOffline(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  clip: AudioClipData,
  dest: AudioNode,
  when: number,
  maxDurationSec: number,
): void {
  const win = audioPlayWindow(clip.loopStartSec, clip.loopEndSec, clip.gridOffsetSec, buffer.duration, maxDurationSec);
  if (!win) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (clip.gain !== 1) {
    const clipGain = ctx.createGain();
    clipGain.gain.value = clip.gain;
    source.connect(clipGain).connect(dest);
  } else {
    source.connect(dest);
  }
  if (win.offset > 0 || win.span < buffer.duration || win.delaySec > 0)
    source.start(when + win.delaySec, win.offset, win.span);
  else source.start(when);
}

/** Peak absolute sample across all channels. 0 means the buffer is silent. */
export function peakAmplitude(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      const magnitude = Math.abs(samples[index]);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}
