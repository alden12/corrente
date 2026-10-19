/**
 * Render one device chain alone, on the engine, anywhere (AGENT-4.9): an instrument and/or effects
 * with their params, fed notes or a test signal, in Node as in the browser. No Web Audio, so the
 * hosted MCP hears exactly what a tab plays, and the agent can check a device it has just built
 * (AGENT-4.8).
 *
 * The chain is one engine plan, as a track plays it (chainPlan): the instrument takes the effects
 * after it into its own plan. A chain that can't be one plan (too heavy for a phone, or a device
 * that isn't an engine device) is refused with a `DeviceRenderError`.
 */
import { EngineBank } from "../bank/bank";
import { BLOCK } from "../bank/exports";
import { chainPlan, type ChainMember } from "../bank/chainPlan";
import { engineValueOf } from "../definitions/values";
import { instrumentSchema } from "../instruments/catalog";
import { effectSchema } from "../effects/catalog";
import { ParamStore } from "../params/store";
import type { ParamSchema, ParamValue } from "../params/types";
import { sampleAudioFor, type LoadAudio, type LoadSample } from "./sampleAudio";

export interface DeviceSpec {
  type: string;
  params?: Record<string, ParamValue>;
}

/** An instrument and the effects after it; effects alone are fed the stimulus as their input. */
export interface DeviceChain {
  instrument?: DeviceSpec;
  effects?: DeviceSpec[];
}

/** A note played into an instrument, in seconds from the start. */
export interface PlayedNote {
  pitch: number;
  start: number;
  length: number;
  velocity?: number;
}

/** What goes in: notes for an instrument; for effects, a click, a short tone burst or a steady sine. */
export type Stimulus =
  | { kind: "notes"; notes: PlayedNote[] }
  | { kind: "impulse" }
  | { kind: "burst"; frequency: number; seconds: number }
  | { kind: "sine"; frequency: number };

export interface Rendered {
  channels: [Float32Array, Float32Array];
  sampleRate: number;
}

/** What a render needs from where it runs: the engine's bytes, and ways to load samples and audio clips. */
export interface RenderSetup {
  engine: BufferSource;
  loadSample: LoadSample;
  /** Audio clips' files, for a project render; where there's no way to load them, they're left out. */
  loadAudio?: LoadAudio;
  /** 48 kHz unless asked. */
  sampleRate?: number;
}

export class DeviceRenderError extends Error {}

const DEFAULT_RATE = 48000;

const storeFor = (schema: ParamSchema, params: Record<string, ParamValue> = {}) => {
  const store = new ParamStore(schema);
  Object.entries(params).forEach(([id, value]) => store.set(id, value));
  return store;
};

/** An effect's input, sample by sample. */
type Signal = (index: number, sampleRate: number) => number;

const SIGNALS: {
  [Kind in Exclude<Stimulus["kind"], "notes">]: (stimulus: Extract<Stimulus, { kind: Kind }>) => Signal;
} = {
  impulse: () => (index) => (index === 0 ? 1 : 0),
  // Hann-windowed, so it starts and ends at zero rather than clicking at its edges.
  burst:
    ({ frequency, seconds }) =>
    (index, sampleRate) => {
      const length = Math.round(seconds * sampleRate);
      if (index >= length) return 0;
      return Math.sin((Math.PI * index) / length) ** 2 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
    },
  sine:
    ({ frequency }) =>
    (index, sampleRate) =>
      Math.sin((2 * Math.PI * frequency * index) / sampleRate),
};

export async function renderDevice(
  chain: DeviceChain,
  stimulus: Stimulus,
  seconds: number,
  { engine, loadSample, sampleRate = DEFAULT_RATE }: RenderSetup,
): Promise<Rendered> {
  const { instrument, effects = [] } = chain;
  if (stimulus.kind === "notes" && !instrument) throw new DeviceRenderError("notes need an instrument to play them");
  if (stimulus.kind !== "notes" && instrument) throw new DeviceRenderError("an instrument is played with notes");

  const members: ChainMember[] = [
    ...(instrument
      ? [
          {
            key: "instrument",
            type: instrument.type,
            store: storeFor(instrumentSchema(instrument.type), instrument.params),
          },
        ]
      : []),
    ...effects.map((effect, index) => ({
      key: `effect${index}`,
      type: effect.type,
      store: storeFor(effectSchema(effect.type), effect.params),
    })),
  ];
  const plan = chainPlan(members, !!instrument);
  if (!plan)
    throw new DeviceRenderError("this chain can't run as one engine plan (too heavy, or not an engine device)");

  const valueOf = (param: string) => {
    const { store, id } = plan.sources[param];
    return engineValueOf(store.spec(id), store.get(id));
  };
  // One per param: a plan can read a param in several places.
  const sources = [
    ...new Map(
      plan.plan.params.filter((source) => plan.sources[source.param]).map((source) => [source.param, source]),
    ).values(),
  ];
  const bank = new EngineBank(engine, sampleRate, 1);
  bank.load(
    0,
    plan.plan,
    Object.fromEntries(
      sources.filter((source) => !source.sample).map((source) => [source.param, valueOf(source.param)]),
    ),
  );
  // A table is the bank's own thing, apart from the same sample played as one (as deviceSamples names them).
  await Promise.all(
    sources
      .filter((source) => source.sample)
      .map(async (source) => {
        const { store, id } = plan.sources[source.param];
        const ref = String(store.get(id));
        const asTable = !!source.wavetable;
        const audio = ref ? await sampleAudioFor(ref, asTable, loadSample, sampleRate) : null;
        bank.setSample(0, source.param, ref && asTable ? `table:${ref}` : ref, audio);
      }),
  );

  if (stimulus.kind === "notes")
    stimulus.notes.forEach((note) => {
      bank.noteOn(0, note.pitch, note.velocity ?? 0.8, note.start);
      bank.noteOff(0, note.pitch, note.start + note.length);
    });
  const signal =
    stimulus.kind === "notes" ? undefined : (SIGNALS[stimulus.kind] as (stimulus: Stimulus) => Signal)(stimulus);

  const blocks = Math.ceil((seconds * sampleRate) / BLOCK);
  const channels: [Float32Array, Float32Array] = [new Float32Array(blocks * BLOCK), new Float32Array(blocks * BLOCK)];
  for (let block = 0; block < blocks; block++) {
    const start = block * BLOCK;
    if (signal)
      [0, 1].forEach((channel) =>
        bank.input(0, channel).forEach((_, index, input) => (input[index] = signal(start + index, sampleRate))),
      );
    bank.process(start / sampleRate);
    channels.forEach((output, channel) => output.set(bank.output(0, channel), start));
  }
  const frames = Math.ceil(seconds * sampleRate);
  return { channels: [channels[0].subarray(0, frames), channels[1].subarray(0, frames)], sampleRate };
}
