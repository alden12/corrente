/**
 * Old sample nodes as zones of one sampler (INST-36.8). A drum kit is a `buffer` per pad, each on its
 * own note (a param, so pads can be moved), tuned, through a `gain` setting its level; a sampler is
 * one `buffer` with a start and a trim in milliseconds. The engine's zones carry all of that, each
 * setting read from its param as a note starts, so both become one sampler reading the zone a note
 * took.
 *
 * Only when every sample node has a note, or there is one: zones pick one sample per note, so several
 * samples layered on every note stay a sampler each (kinds.ts).
 */
import type { BufferNodeSpec, Connection, Graph, NodeSpec } from "../../graph/types";
import type { ParamSpec } from "../../params/types";
import type { ParamBinding, Zone } from "../format";
import { scaled, valueOf } from "./fields";

export interface ZonedSamples {
  /** Old ids the zoned sampler plays instead: the sample nodes, and gains that only set a pad's level. */
  replaced: Set<string>;
  zones: Zone[];
  /** Whether a released note plays on (a one-shot), stops with the note, or a param says which. */
  oneShot: boolean | ParamBinding;
  added: ParamSpec[];
  notes: string[];
}

const isBuffer = (spec: NodeSpec): spec is BufferNodeSpec => spec.kind === "buffer";

/** The zones a graph's sample nodes become, if they can. */
export const zonedSamples = (graph: Graph): ZonedSamples | undefined => {
  const buffers = graph.nodes.filter(isBuffer);
  const keyed = buffers.filter((buffer) => buffer.note !== undefined);
  if (buffers.length === 0 || (buffers.length > 1 && keyed.length < buffers.length)) return undefined;

  const from = (id: string) => graph.connections.filter(([source]) => source === id);
  const into = (to: string) =>
    graph.connections.filter(([, target]: Connection) => target === to || target.startsWith(`${to}.`));
  /** A gain whose only input is this sample node, and that is all the sample node feeds: its level. */
  const levelOf = (buffer: BufferNodeSpec) => {
    const out = from(buffer.id);
    if (out.length !== 1 || out[0][1].includes(".")) return undefined;
    const gain = graph.nodes.find((spec) => spec.id === out[0][1]);
    if (gain?.kind !== "gain" || into(gain.id).length !== 1) return undefined;
    return gain;
  };

  const added: ParamSpec[] = [];
  const notes: string[] = [];
  const replaced = new Set<string>();
  const zones = buffers.map((buffer): Zone => {
    replaced.add(buffer.id);
    const level = levelOf(buffer);
    if (level) replaced.add(level.id);
    if (into(buffer.id).length > 0) notes.push(`${buffer.id}'s pitch modulation isn't converted: it plays at its note`);
    const sample = sampleParam(buffer, added);
    const note = buffer.note === undefined ? undefined : valueOf(buffer.note, 0);
    return {
      sample,
      root: valueOf(buffer.root, 60),
      ...(note !== undefined && { keys: [note, note] }),
      ...(buffer.detune !== undefined && { tune: scaled(buffer.detune, 0.01) }),
      ...(level?.gain !== undefined && { level: scaled(level.gain, 1) }),
      ...(buffer.keytrack !== undefined && {
        keytrack: typeof buffer.keytrack === "boolean" ? buffer.keytrack : { param: buffer.keytrack.param },
      }),
      ...(buffer.start !== undefined && { trimStart: scaled(buffer.start, 1) }),
      ...(buffer.trimEnd !== undefined && { trimEnd: scaled(buffer.trimEnd, 1) }),
    };
  });

  const oneShots = buffers.map((buffer) =>
    buffer.oneShot === undefined || typeof buffer.oneShot === "boolean"
      ? (buffer.oneShot ?? true)
      : { param: buffer.oneShot.param },
  );
  if (new Set(oneShots.map((each) => JSON.stringify(each))).size > 1) {
    notes.push("its samples differed in playing on after the note; they all follow the first now");
  }
  return { replaced, zones, oneShot: oneShots[0], added, notes };
};

/** A sample node's sample as a param: its own, or one added for a sample it named directly. */
const sampleParam = (buffer: BufferNodeSpec, added: ParamSpec[]): ParamBinding => {
  if (typeof buffer.sample !== "string") return { param: buffer.sample.param };
  const id = `${buffer.id}.sample`;
  added.push({ id, label: "Sample", kind: "sample", default: buffer.sample });
  return { param: id };
};
