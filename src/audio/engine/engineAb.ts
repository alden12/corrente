/**
 * Each built-in on both engines (INST-36.8's A/B): the old Web Audio graph and its conversion to the
 * new engine, given the same note or the same input, rendered offline and measured the same way, so
 * the two can be compared by ear and by number before the built-ins switch over.
 *
 * Browser only: the old engine renders under an OfflineAudioContext (renderIsolated), and samples
 * decode through one. The new engine runs in an EngineBank on this thread, as the tests run it.
 */
import { analyzeMix } from "../analysis/analyze";
import { spectrumOf, type Spectrum } from "../analysis/spectrum";
import { EngineBank } from "../bank/bank";
import { DeviceSamples } from "../bank/deviceSamples";
import { BLOCK } from "../bank/exports";
import { fetchEngine } from "../bank/pool";
import { composeChain } from "../definitions/chain";
import { compileDefinition } from "../definitions/compile";
import { effectFromGraph, instrumentFromGraph, type Converted } from "../definitions/fromGraph";
import { engineValueOf } from "../definitions/values";
import { BUILTIN_GRAPH_EFFECTS, BUILTIN_GRAPH_INSTRUMENTS } from "../graph/builtins";
import { renderIsolated, type IsolatedInput } from "./renderIsolated";

const RATE = 48000;
const SECONDS = 2.5;
/**
 * An instrument plays A3 for a second, or the note of its first zone (a drum kit's first pad); an
 * effect gets a second of a 220 Hz tone burst.
 */
const NOTE = { pitch: 57, holdSec: 1, velocity: 0.9 };

const pitchOf = (abCase: AbCase): number => {
  if ("problem" in abCase.converted) return NOTE.pitch;
  const { definition, schema } = abCase.converted;
  const key = definition.zones?.[0].keys?.[0];
  if (key === undefined) return NOTE.pitch;
  if (typeof key === "number") return key;
  const spec = schema.find((each) => each.id === key.param);
  return spec?.kind === "number" ? spec.default : NOTE.pitch;
};
const BURST = { kind: "burst", frequency: 220, seconds: 1 } as const satisfies IsolatedInput;

/** A built-in to compare: converted, or why it couldn't be. */
export interface AbCase {
  type: string;
  effect: boolean;
  converted: Converted | { problem: string };
}

export const AB_CASES: AbCase[] = [
  ...BUILTIN_GRAPH_INSTRUMENTS.map((def) => ({
    type: def.type,
    effect: false,
    converted: attempt(() => instrumentFromGraph(def)),
  })),
  ...BUILTIN_GRAPH_EFFECTS.map((def) => ({
    type: def.type,
    effect: true,
    converted: attempt(() => effectFromGraph(def)),
  })),
];

function attempt(convert: () => Converted): Converted | { problem: string } {
  try {
    return convert();
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

/** One render, measured. */
export interface Measured {
  channels: Float32Array[];
  peakDbfs: number;
  rmsDbfs: number;
  spectrum: Spectrum;
}

const measured = (channels: Float32Array[]): Measured => {
  const mix = analyzeMix({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: RATE,
    duration: channels[0].length / RATE,
    getChannelData: (channel) => channels[channel],
  });
  // The spectrum of left and right together.
  const mono = channels[0].map((value, index) => (value + (channels[1]?.[index] ?? value)) / 2);
  return { channels, peakDbfs: mix.peakDbfs, rmsDbfs: mix.rmsDbfs, spectrum: spectrumOf(mono, RATE) };
};

/** The old engine's render. */
export async function renderOld(abCase: AbCase): Promise<Measured> {
  const chain = abCase.effect ? { effects: [{ type: abCase.type }] } : { instrument: { type: abCase.type } };
  const input: IsolatedInput = abCase.effect ? BURST : { kind: "note", ...NOTE, pitch: pitchOf(abCase) };
  const buffer = await renderIsolated(chain, input, { durationSec: SECONDS, sampleRate: RATE });
  return measured([0, 1].map((channel) => buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))));
}

/** The burst renderIsolated plays an effect, sample by sample. */
const burstAt = (index: number) => {
  const length = BURST.seconds * RATE;
  if (index >= length) return 0;
  return Math.sin((Math.PI * index) / length) ** 2 * Math.sin((2 * Math.PI * BURST.frequency * index) / RATE);
};

/** The new engine's render of the conversion, given the same note or input. */
export async function renderNew(abCase: AbCase): Promise<Measured> {
  if ("problem" in abCase.converted) throw new Error(abCase.converted.problem);
  const { definition, schema } = abCase.converted;
  // Through a chain, as a track runs it: an effect gets its mix as it will live.
  const composed = composeChain([{ key: "device", definition, schema, effect: abCase.effect }]);
  const bank = new EngineBank(await fetchEngine(), RATE, 1);
  const values = Object.fromEntries(
    composed.schema.flatMap((spec) => (spec.kind === "sample" ? [] : [[spec.id, engineValueOf(spec, spec.default)]])),
  );
  bank.load(0, compileDefinition(composed.definition, { params: composed.schema }), values);

  const decoder = new OfflineAudioContext(1, 1, RATE);
  const samples = new DeviceSamples(decoder, ({ param, ref, audio }) => {
    bank.setSample(0, param, ref, audio);
    samples.heard(param, ref);
  });
  composed.schema.forEach(
    (spec) => spec.kind === "sample" && samples.request(spec.id, spec.default, spec.wavetable ?? false),
  );
  await samples.ready();

  if (!abCase.effect) {
    bank.noteOn(0, pitchOf(abCase), NOTE.velocity, 0);
    bank.noteOff(0, pitchOf(abCase), NOTE.holdSec);
  }
  const blocks = Math.ceil((SECONDS * RATE) / BLOCK);
  const channels = [new Float32Array(blocks * BLOCK), new Float32Array(blocks * BLOCK)];
  Array.from({ length: blocks }, (_, block) => {
    if (abCase.effect)
      [0, 1].forEach((channel) =>
        bank.input(0, channel).forEach((_, index, input) => (input[index] = burstAt(block * BLOCK + index))),
      );
    bank.process((block * BLOCK) / RATE);
    channels.forEach((channel, index) => channel.set(bank.output(0, index), block * BLOCK));
  });
  return measured(channels.map((channel) => channel.subarray(0, SECONDS * RATE)));
}
