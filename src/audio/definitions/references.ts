/**
 * What an input reads (INST-36.4): a definition's numbers, params and references (`osc`,
 * `svf.highpass`, `voice.gate`) as sources. Shared by the schema, which reports a reference that
 * names nothing, and the compiler, which turns sources into plan words.
 */
import { blockNamed } from "./catalogue";
import {
  TRACK_INPUTS,
  VOICE_SIGNALS,
  VOICE_SUM,
  type DeviceDefinition,
  type InputValue,
  type ParamBinding,
} from "./format";

export type Source =
  | { type: "node"; name: string; port: number }
  | { type: "param"; binding: ParamBinding }
  | { type: "const"; value: number }
  | { type: "voice"; signal: number }
  | { type: "voiceSum"; channel: number }
  | { type: "input"; channel: number };

const signalSources: Record<string, Source> = {
  ...Object.fromEntries(Object.entries(VOICE_SIGNALS).map(([name, signal]) => [name, { type: "voice", signal }])),
  ...Object.fromEntries(Object.entries(VOICE_SUM).map(([name, channel]) => [name, { type: "voiceSum", channel }])),
  ...Object.fromEntries(Object.entries(TRACK_INPUTS).map(([name, channel]) => [name, { type: "input", channel }])),
};

/** An input's items: one, or the several it sums. */
export const listOf = (value: InputValue) => (Array.isArray(value) ? value : [value]);

/** A `voice` or `output`: one reference (mono, or in both channels), or a left and a right. */
export const channelsOf = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

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

/** One input's sources, for a definition the schema has passed. */
export const sourcesOf = (value: InputValue, nodes: DeviceDefinition["nodes"]): Source[] =>
  listOf(value).map((item) => {
    if (typeof item === "number") return { type: "const", value: item };
    if (typeof item === "string") return referenceTo(item, nodes) as Source;
    return { type: "param", binding: item };
  });
