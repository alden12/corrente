/**
 * Render a whole project on the engine, anywhere (AGENT-4.9 part 2): what the agent hears when it
 * listens to the song, in Node as in the browser, without Web Audio.
 *
 * It builds what AudioEngine builds and runs it block by block:
 * - **Each track and group is a chain of engine slots.** An instrument takes the engine effects
 *   straight after it into its own plan; the rest of a chain splits into runs as the live engine
 *   splits them (chainPlan), each at its stage (stages.ts).
 * - **One bank per stage, run in stage order.** Live, each stage is its own worklet node and Web
 *   Audio carries audio from one to the next within a block; here each stage's slots read what the
 *   stages before them played this block, so nothing is a block late.
 * - **The mix as live:** each track and group at its volume (silent when muted or soloed out),
 *   delayed to make up for later chains beside it (latency.ts), summed into its group and on to
 *   master, then the soft clip. `masterPeak` reports the level going into the master, which is
 *   what to judge clipping by.
 *
 * An audio track's clips are laid onto a tape (audioTape.ts) its effects hear. What a render can't
 * play is named in `omitted` rather than silently left out: an effect that isn't an engine device,
 * audio clips where there's no way to load them. (Sidechain sources can't be set yet, DAW-63; the
 * core will need the same wiring as AudioEngine when they can.)
 */
import { EngineBank } from "../bank/bank";
import { BLOCK } from "../bank/exports";
import { instrumentChain, piecesOf, runParts, type ChainPlan } from "../bank/chainPlan";
import { groupDepth, groupEffectStage, INSTRUMENT_STAGE, trackEffectStage } from "../bank/stages";
import { engineValueOf } from "../definitions/values";
import { compensate, type MixNode } from "../engine/latency";
import { soloMutedTrackIds } from "../engine/mix";
import { softClip } from "../engine/softClip";
import { beatsToSeconds } from "../sequencer/scheduler";
import type { AudioTrack, EffectInstance, Group, InstrumentTrack, ProjectStore, Track } from "../project/projectStore";
import { sampleAudioFor } from "./sampleAudio";
import type { Rendered, RenderSetup } from "./renderDevice";
import { trackNotes, type ScheduledNote } from "./trackNotes";
import { midiChain } from "../midi/device/registry";
import { audioTape } from "./audioTape";
import type { NoteTarget } from "../midi/device/GraphMidiDevice";

export interface ProjectRender extends Rendered {
  /** The loudest sample going into the master, before the soft clip: over 1 means it clips. */
  masterPeak: number;
  /** What the project has that this render doesn't play yet, one line each. */
  omitted: string[];
}

export interface ProjectRenderOptions {
  /** Seconds rendered after the arrangement ends, for tails. 2 unless asked. */
  tailSec?: number;
}

const DEFAULT_TAIL_SEC = 2;
const DEFAULT_RATE = 48000;

type Stereo = [Float32Array, Float32Array];
const silence = (): Stereo => [new Float32Array(BLOCK), new Float32Array(BLOCK)];

/** One engine plan in a chain: where it runs, and the effects it carries (for their bypass). */
interface Slot {
  chain: ChainPlan;
  stage: number;
  effects: EffectInstance[];
  /** Its place in its stage's bank. */
  track: number;
  /** What it played this block. */
  out: Stereo;
}

/** A track or group in the mix: its slots in order, its volume, and where it goes. */
interface Strip {
  id: string;
  parentId: string | null;
  isGroup: boolean;
  slots: Slot[];
  gain: number;
  /** The previous blocks' last `delay` samples, per channel: its latency compensation. */
  history: Stereo;
}

/** The slots a run of effects makes, each at the stage of its first effect's place in the chain. */
const effectSlots = (
  effects: EffectInstance[],
  all: EffectInstance[],
  stageAt: (index: number) => number,
  omitted: string[],
  where: string,
): Omit<Slot, "track" | "out">[] =>
  piecesOf(effects).flatMap((piece) => {
    if (piece.kind === "single") {
      omitted.push(`${where}: effect "${piece.effect.type}" isn't an engine device, so it's passed through`);
      return [];
    }
    return runParts(piece.effects).flatMap(({ plan: chain, effects: part }) => {
      if (!chain) {
        omitted.push(`${where}: effect "${part[0].type}" is too heavy for the engine`);
        return [];
      }
      return [{ chain, stage: stageAt(all.indexOf(part[0])), effects: part }];
    });
  });

/** A plan's values: each param read from its device's store, and each carried effect's bypass. */
const valuesOf = ({ plan, sources, bypass }: ChainPlan, effects: EffectInstance[]) => ({
  ...Object.fromEntries(
    [
      ...new Set(plan.params.filter((source) => !source.sample && sources[source.param]).map((source) => source.param)),
    ].map((param) => {
      const { store, id } = sources[param];
      return [param, engineValueOf(store.spec(id), store.get(id))];
    }),
  ),
  ...Object.fromEntries(
    effects.flatMap((effect) => {
      const param = bypass.get(effect.id);
      return param ? [[param, effect.bypassed ? 1 : 0]] : [];
    }),
  ),
});

/** Delay a block by `delay` samples through a strip's history. */
function delayed(block: Stereo, history: Stereo, delay: number): Stereo {
  if (delay === 0) return block;
  return block.map((channel, index) => {
    const joined = new Float32Array(delay + BLOCK);
    joined.set(history[index]);
    joined.set(channel, delay);
    history[index] = joined.slice(BLOCK);
    return joined.subarray(0, BLOCK);
  }) as Stereo;
}

export async function renderProject(
  project: ProjectStore,
  { engine, loadSample, loadAudio, sampleRate = DEFAULT_RATE }: RenderSetup,
  { tailSec = DEFAULT_TAIL_SEC }: ProjectRenderOptions = {},
): Promise<ProjectRender> {
  const timeline = {
    tempo: project.tempo,
    loopStart: project.loopStart,
    length: project.length,
    groove: project.getGroove(),
  };
  const tracks = project.getTracks();
  const groups = project.getGroups();
  const silenced = soloMutedTrackIds(groups, tracks);
  const omitted: string[] = [];

  // --- the chains ---------------------------------------------------------------------------
  const slotsOfTrack = (track: Track): Omit<Slot, "track" | "out">[] => {
    if (track.kind === "audio") {
      if (track.placements.length > 0 && !loadAudio)
        omitted.push(`audio track "${track.name}": audio clips can't be loaded here, so it's silent`);
      return effectSlots(
        track.effects,
        track.effects,
        (index) => trackEffectStage(index),
        omitted,
        `track "${track.name}"`,
      );
    }
    const chain = instrumentChain(track.instrumentType, track.params, track.effects);
    if (!chain) return [];
    const rest = track.effects.slice(chain.absorbed.length);
    return [
      { chain: chain.plan, stage: INSTRUMENT_STAGE, effects: chain.absorbed },
      ...effectSlots(rest, track.effects, (index) => trackEffectStage(index), omitted, `track "${track.name}"`),
    ];
  };
  const slotsOfGroup = (group: Group) =>
    effectSlots(
      group.effects,
      group.effects,
      (index) => groupEffectStage(groupDepth(groups, group.id), index),
      omitted,
      `group "${group.name}"`,
    );

  const strips: (Strip & {
    pending: Omit<Slot, "track" | "out">[];
    track?: InstrumentTrack;
    audio?: AudioTrack;
  })[] = [
    ...tracks.map((track) => ({
      id: track.id,
      parentId: track.parentId,
      isGroup: false,
      pending: slotsOfTrack(track),
      gain: silenced.has(track.id) ? 0 : track.volume,
      track: track.kind === "instrument" ? track : undefined,
      audio: track.kind === "audio" ? track : undefined,
    })),
    ...groups.map((group) => ({
      id: group.id,
      parentId: group.parentId,
      isGroup: true,
      pending: slotsOfGroup(group),
      gain: group.muted ? 0 : group.volume,
    })),
  ].map((strip) => ({ ...strip, slots: [], history: silence() }));

  // --- one bank per stage -------------------------------------------------------------------
  const byStage = new Map<number, Slot[]>();
  strips.forEach((strip) =>
    strip.pending.forEach((pending) => {
      const atStage = byStage.get(pending.stage) ?? [];
      const slot: Slot = { ...pending, track: atStage.length, out: silence() };
      byStage.set(pending.stage, [...atStage, slot]);
      strip.slots.push(slot);
    }),
  );
  const stages = [...byStage.keys()].sort((a, b) => a - b);
  const banks = new Map(stages.map((stage) => [stage, new EngineBank(engine, sampleRate, byStage.get(stage)!.length)]));
  const transport = { time: 0, beat: timeline.loopStart, tempo: timeline.tempo, playing: true };
  await Promise.all(
    stages.flatMap((stage) => {
      const bank = banks.get(stage)!;
      bank.setTransport(transport);
      return byStage.get(stage)!.flatMap((slot) => {
        const { plan, sources } = slot.chain;
        bank.load(slot.track, plan, valuesOf(slot.chain, slot.effects));
        // A table is the bank's own thing, apart from the same sample played as one (as deviceSamples names them).
        const samples = [
          ...new Map(
            plan.params
              .filter((source) => source.sample && sources[source.param])
              .map((source) => [source.param, source]),
          ).values(),
        ];
        return samples.map(async (source) => {
          const { store, id } = sources[source.param];
          const ref = String(store.get(id));
          const asTable = !!source.wavetable;
          const audio = ref ? await sampleAudioFor(ref, asTable, loadSample, sampleRate) : null;
          bank.setSample(slot.track, source.param, ref && asTable ? `table:${ref}` : ref, audio);
        });
      });
    }),
  );

  // --- the notes ----------------------------------------------------------------------------
  // Each track's notes go in through its MIDI devices to its instrument's slot. A generator (an
  // arpeggiator) plays steps off the transport, so rather than its own timer the render drives it:
  // each block, the notes starting in it go in, then every step landing in it comes out.
  const secondsPerBeat = 60 / timeline.tempo;
  const clock = {
    playing: true,
    currentTime: 0,
    secondsPerBeat,
    continuousBeatAtTime: (time: number) => timeline.loopStart + time / secondsPerBeat,
    drivesSteps: true,
  };
  const instruments = banks.get(INSTRUMENT_STAGE);
  const players = strips.flatMap((strip) => {
    const first = strip.slots[0];
    if (!strip.track || !instruments || first?.stage !== INSTRUMENT_STAGE) return [];
    const slot: NoteTarget = {
      noteOn: (pitch, velocity = 1, when = clock.currentTime) => instruments.noteOn(first.track, pitch, velocity, when),
      noteOff: (pitch, when = clock.currentTime) => instruments.noteOff(first.track, pitch, when),
      playNote: (pitch, length, velocity = 1, when = clock.currentTime) => {
        instruments.noteOn(first.track, pitch, velocity, when);
        instruments.noteOff(first.track, pitch, when + length);
      },
      allNotesOff: () => {},
    };
    const { head, devices } = midiChain(strip.track.midiDevices, slot, clock);
    // Each note under the block it starts in, so a block plays just its own.
    const byBlock = trackNotes(strip.track, timeline).reduce((blocks, note) => {
      const block = Math.floor((note.start * sampleRate) / BLOCK);
      return blocks.set(block, [...(blocks.get(block) ?? []), note]);
    }, new Map<number, ScheduledNote[]>());
    return [{ head, devices, byBlock }];
  });
  const generators = players.flatMap((player) => player.devices.filter((device) => device.generates));

  // --- latency compensation -----------------------------------------------------------------
  const latencyOf = (strip: Strip) => strip.slots.reduce((sum, slot) => sum + slot.chain.plan.latency, 0);
  const mixNode = (strip: Strip): MixNode => ({ id: strip.id, parentId: strip.parentId, latency: latencyOf(strip) });
  const { delays, total } = compensate(
    strips.filter((strip) => !strip.isGroup).map(mixNode),
    strips.filter((strip) => strip.isGroup).map(mixNode),
  );
  strips.forEach((strip) => {
    const delay = delays.get(strip.id) ?? 0;
    strip.history = [new Float32Array(delay), new Float32Array(delay)];
  });

  // --- block by block -----------------------------------------------------------------------
  const children = (parentId: string | null) => strips.filter((strip) => strip.parentId === parentId);
  // Master hears everything `total` samples late; render that much more and drop it from the front.
  const frames = Math.ceil(
    (beatsToSeconds(Math.max(0, timeline.length - timeline.loopStart), timeline.tempo) + tailSec) * sampleRate,
  );
  const blocks = Math.ceil((frames + total) / BLOCK);
  const master: Stereo = [new Float32Array(blocks * BLOCK), new Float32Array(blocks * BLOCK)];
  const tapes = new Map(
    await Promise.all(
      strips.flatMap(({ id, audio }) => {
        if (!audio || !loadAudio) return [];
        return [
          audioTape(audio, timeline, blocks * BLOCK, sampleRate, loadAudio).then(({ tape, missing }) => {
            missing.forEach((fileId) => omitted.push(`audio track "${audio.name}": file ${fileId} wouldn't load`));
            return [id, tape] as const;
          }),
        ];
      }),
    ),
  );
  let masterPeak = 0;

  for (let block = 0; block < blocks; block++) {
    const start = block * BLOCK;
    const [from, to] = [start / sampleRate, (start + BLOCK) / sampleRate];
    clock.currentTime = from;
    players.forEach(({ head, byBlock }) =>
      byBlock.get(block)?.forEach((note) => head.playNote(note.pitch, note.length, note.velocity, note.start)),
    );
    generators.forEach((generator) => generator.scheduleWindow(from, to));
    const outputs = new Map<string, Stereo>();
    /** What a strip's chain starts from this block: a group's bus, an audio track's tape (an instrument plays its own). */
    const feedOf = (strip: Strip): Stereo | undefined => {
      if (strip.isGroup) return busOf(strip.id);
      const tape = tapes.get(strip.id);
      return tape && [tape[0].subarray(start, start + BLOCK), tape[1].subarray(start, start + BLOCK)];
    };
    /** A strip's output this block: its last slot (or, without effects, what feeds it), at its volume, delayed. */
    const outputOf = (strip: Strip): Stereo => {
      const done = outputs.get(strip.id);
      if (done) return done;
      const last = strip.slots[strip.slots.length - 1];
      const raw = last ? last.out : (feedOf(strip) ?? silence());
      const out = delayed(
        raw.map((channel) => channel.map((sample) => sample * strip.gain)) as Stereo,
        strip.history,
        delays.get(strip.id) ?? 0,
      );
      outputs.set(strip.id, out);
      return out;
    };
    /** Everything routed into a bus this block, summed. */
    const busOf = (parentId: string | null): Stereo =>
      children(parentId).reduce<Stereo>((sum, child) => {
        const out = outputOf(child);
        sum.forEach((channel, index) => channel.forEach((_, sample) => (channel[sample] += out[index][sample])));
        return sum;
      }, silence());

    for (const stage of stages) {
      const bank = banks.get(stage)!;
      // Each slot's input: the slot before it in its chain, or for a group's first, its bus.
      strips.forEach((strip) =>
        strip.slots.forEach((slot, index) => {
          if (slot.stage !== stage) return;
          const input = index > 0 ? strip.slots[index - 1].out : feedOf(strip);
          if (!input) return;
          [0, 1].forEach((channel) => bank.input(slot.track, channel).set(input[channel]));
        }),
      );
      bank.process(start / sampleRate);
      byStage.get(stage)!.forEach((slot) => {
        slot.out = [bank.output(slot.track, 0).slice(), bank.output(slot.track, 1).slice()];
      });
    }

    const mixed = busOf(null);
    mixed.forEach((channel, index) =>
      channel.forEach((sample, frame) => {
        masterPeak = Math.max(masterPeak, Math.abs(sample));
        master[index][start + frame] = softClip(sample);
      }),
    );
  }

  players.forEach((player) => player.devices.forEach((device) => device.dispose()));
  return {
    channels: [master[0].slice(total, total + frames), master[1].slice(total, total + frames)],
    sampleRate,
    masterPeak,
    omitted,
  };
}
