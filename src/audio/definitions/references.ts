/**
 * What an input reads (INST-36.4): a definition's numbers, params and references (`osc`,
 * `svf.highpass`, `voice.gate`) as sources. Shared by the schema, which reports a reference that
 * names nothing, and the compiler, which turns sources into plan words.
 */
import { blockNamed } from "./catalogue";
import type { ParamSchema } from "../params/types";
import {
  DEFAULT_VOICES,
  HOST_SIGNALS,
  SAMPLE_INPUTS,
  TABLE_INPUTS,
  TRACK_INPUTS,
  VOICE_SIGNALS,
  VOICE_SUM,
  type DeviceDefinition,
  type InputValue,
  type ParamBinding,
  type ScaledReference,
  type Synced,
} from "./format";

export type Source =
  | { type: "node"; name: string; port: number }
  | { type: "param"; binding: ParamBinding }
  | { type: "const"; value: number }
  | { type: "voice"; signal: number }
  | { type: "voiceSum"; channel: number }
  | { type: "input"; channel: number }
  | { type: "host"; signal: number };

/** A scale or an offset: a number, or a param's value. */
export type Amount = { type: "const"; value: number } | { type: "param"; binding: ParamBinding };

/** What an input names before the compiler places it: a source, or one scaled (nodes to add). */
export type InputSource = Source | { type: "scaled"; source: Source; scale: Amount; offset: Amount };

/** What an input reads underneath any scaling: what the section rules look at. */
export const underlying = (source: InputSource): Source => (source.type === "scaled" ? source.source : source);

type Item = ParamBinding | ScaledReference | Synced;

/** Whether an item is a scaled reference. */
export const isScaled = (item: Item): item is ScaledReference => "from" in item;

/** Whether an item is a tempo-synced length. */
export const isSynced = (item: Item): item is Synced => "beats" in item;

/**
 * A note division's length in beats (a beat is a quarter note): `"1/8"` is half a beat, `"1/8T"` a
 * triplet (two thirds of that), `"1/8."` dotted (half as long again), `"2/1"` eight beats. Undefined
 * if it isn't one.
 */
export const beatsOf = (division: string): number | undefined => {
  const match = /^(\d+)\/(\d+)([T.]?)$/.exec(division.trim());
  if (!match || Number(match[2]) === 0 || Number(match[1]) === 0) return undefined;
  const feel = { "": 1, T: 2 / 3, ".": 1.5 }[match[3] as "" | "T" | "."];
  return ((4 * Number(match[1])) / Number(match[2])) * feel;
};

/**
 * What each unit scales, and how a length in beats turns into its scale: a host signal, or (for the
 * beats themselves) a plain 1.
 */
const SYNC: Record<Synced["as"], { signal?: keyof typeof HOST_SIGNALS; scaleFor: (beats: number) => number }> = {
  hz: { signal: "host.tempo", scaleFor: (beats) => 1 / (60 * beats) },
  seconds: { signal: "host.beatSeconds", scaleFor: (beats) => beats },
  samples: { signal: "host.beatSamples", scaleFor: (beats) => beats },
  beats: { scaleFor: (beats) => beats },
};

const signalSources: Record<string, Source> = {
  ...Object.fromEntries(Object.entries(VOICE_SIGNALS).map(([name, signal]) => [name, { type: "voice", signal }])),
  ...Object.fromEntries(Object.entries(VOICE_SUM).map(([name, channel]) => [name, { type: "voiceSum", channel }])),
  ...Object.fromEntries(Object.entries(TRACK_INPUTS).map(([name, channel]) => [name, { type: "input", channel }])),
  ...Object.fromEntries(Object.entries(HOST_SIGNALS).map(([name, signal]) => [name, { type: "host", signal }])),
};

/** An input's items: one, or the several it sums. */
export const listOf = (value: InputValue) => (Array.isArray(value) ? value : [value]);

/** A `voice` or `output`: one reference (mono, or in both channels), or a left and a right. */
export const channelsOf = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Whether any node runs per voice: an instrument's definition does, an effect's doesn't. */
export const hasVoiceNodes = (definition: DeviceDefinition): boolean =>
  Object.values(definition.nodes).some((node) => node.voice);

/** How many voices a definition plays: as it says, or DEFAULT_VOICES if it has voice nodes and doesn't. */
export const voicesOf = (definition: DeviceDefinition): number =>
  definition.voices ?? (hasVoiceNodes(definition) ? DEFAULT_VOICES : 0);

/** What a definition plays, by channel: its output, or the voices summed if it has voices and doesn't say. */
export const outputOf = (definition: DeviceDefinition): string[] =>
  channelsOf(definition.output ?? (voicesOf(definition) > 0 ? ["voices.left", "voices.right"] : undefined));

/** The params a definition binds to the inputs `inputs` names by block (SAMPLE_INPUTS, TABLE_INPUTS). */
export const paramsOn = (definition: DeviceDefinition, inputs: Record<string, readonly string[]>): string[] =>
  Object.values(definition.nodes).flatMap((node) =>
    (inputs[node.block] ?? []).flatMap((port) => {
      const input = node.inputs?.[port];
      return typeof input === "object" && !Array.isArray(input) && "param" in input ? [input.param] : [];
    }),
  );

/** A definition's sample params: those its sample and table inputs and its zones name, and which are tables. */
export const sampleParamsOf = (definition: DeviceDefinition) => {
  const tables = new Set(paramsOn(definition, TABLE_INPUTS));
  const samples = [
    ...paramsOn(definition, SAMPLE_INPUTS),
    ...(definition.zones ?? []).map((zone) => zone.sample.param),
  ];
  return { samples: new Set([...samples, ...tables]), tables, both: samples.filter((param) => tables.has(param)) };
};

/** A reference as a source, or what's wrong with it. */
export const referenceTo = (reference: string, nodes: DeviceDefinition["nodes"]): Source | string => {
  const signal = signalSources[reference];
  if (signal) return signal;
  const [name, port, ...rest] = reference.split(".");
  const node = nodes[name];
  if (!node || rest.length > 0) return `"${reference}" is not a node or a signal`;
  const block = blockNamed(node.block)!;
  const index = port === undefined ? 0 : block.outputs.findIndex((output) => output.name === port);
  if (index < 0 || block.outputs.length === 0) {
    return `${name} (a ${node.block}) has no output "${port}" (it has ${block.outputs.map((output) => output.name).join(", ") || "none"})`;
  }
  return { type: "node", name, port: index };
};

const amountOf = (amount: number | ParamBinding | undefined, otherwise: number): Amount =>
  amount === undefined
    ? { type: "const", value: otherwise }
    : typeof amount === "number"
      ? { type: "const", value: amount }
      : { type: "param", binding: amount };

/**
 * A tempo-synced length as a host signal scaled. A param's beats become a table: a choice of
 * divisions maps each option to its scale, and a number of beats scales a length directly (the
 * schema refuses one as a rate, which would need dividing by it).
 */
const syncedSource = (item: Synced, params: ParamSchema | undefined): InputSource => {
  const { signal, scaleFor } = SYNC[item.as];
  const fixed = typeof item.beats === "string" ? beatsOf(item.beats) : item.beats;
  if (typeof fixed === "number" && !signal) return { type: "const", value: scaleFor(fixed) };
  const source: Source = signal ? { type: "host", signal: HOST_SIGNALS[signal] } : { type: "const", value: 1 };
  if (typeof fixed === "number") {
    return { type: "scaled", source, scale: { type: "const", value: scaleFor(fixed) }, offset: amountOf(undefined, 0) };
  }
  const binding = item.beats as ParamBinding;
  const spec = params?.find((candidate) => candidate.id === binding.param);
  const scale: ParamBinding =
    spec?.kind === "enum"
      ? { param: binding.param, table: spec.options.map((option, index) => [index, scaleFor(beatsOf(option) ?? 1)]) }
      : binding;
  return { type: "scaled", source, scale: { type: "param", binding: scale }, offset: amountOf(undefined, 0) };
};

/** One input's sources, for a definition the schema has passed. */
export const sourcesOf = (value: InputValue, nodes: DeviceDefinition["nodes"], params?: ParamSchema): InputSource[] =>
  listOf(value).map((item): InputSource => {
    if (typeof item === "number") return { type: "const", value: item };
    if (typeof item === "string") return referenceTo(item, nodes) as Source;
    if (isScaled(item)) {
      const source = referenceTo(item.from, nodes) as Source;
      return { type: "scaled", source, scale: amountOf(item.scale, 1), offset: amountOf(item.offset, 0) };
    }
    if (isSynced(item)) return syncedSource(item, params);
    return { type: "param", binding: item };
  });
