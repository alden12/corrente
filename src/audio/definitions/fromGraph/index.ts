/**
 * The old graph format to the new definition format (INST-36.8): what moves built-in and custom
 * devices onto the engine. Pure, DOM-free; the project upcaster and the built-ins both use it.
 *
 * - **Each node converts by its kind** (kinds.ts). Old ids become node names, made into plain words.
 * - **Stereo is worked out, not assumed.** Web Audio nodes carry whatever channels they're given;
 *   engine blocks are mono unless they say. So a processor fed stereo (an effect's input, a pan, a
 *   stereo sample) runs a copy per channel, and sources stay mono.
 * - **An instrument's voice** goes to `amp` (the old base's attack and release) or `out` (the voice
 *   shapes itself), and `amp.level` turns the voices down after. Velocity needs nothing: the engine
 *   scales each voice by it, as the old base did.
 * - **An effect** reads `in` as the track's input and plays `wet`; its `mix` is the chain's to apply.
 * - **What can't convert exactly converts to the nearest sound**, and says so in `notes`: a device is
 *   never dropped (decided 2026-10-15).
 */
import type { Connection, Graph, GraphEffectDef, GraphInstrumentDef, NodeSpec } from "../../graph/types";
import type { ParamSchema, ParamSpec } from "../../params/types";
import { compileDefinition, DefinitionError } from "../compile";
import { DEFAULT_VOICES, RESERVED_NAMES, type DefinitionNode, type DeviceDefinition, type InputValue } from "../format";
import { summed, type SingleInput } from "./fields";
import { KINDS, type KindContext } from "./kinds";

export interface Converted {
  /** The old schema, plus any params the conversion added (a sample a node named directly). */
  schema: ParamSchema;
  definition: DeviceDefinition;
  /** What sounds different from before, in words for the device's owner. */
  notes: string[];
}

/** Voices a converted instrument starts with: the old ones had no limit. Fewer if a phone can't run them. */
const VOICES = 16;
const SIDES = ["l", "r"];

/** Endpoints the old format reserves, as what they read from. */
const EFFECT_INPUT = "in";

interface Conversion {
  nodes: Record<string, DefinitionNode>;
  notes: string[];
  added: ParamSpec[];
  /** A node's references by channel: one when mono, left and right when stereo. */
  outputsOf(id: string): string[];
  /** What is connected to an endpoint (a node, `node.param`, or a reserved one), on `channel`. */
  sources(to: string, channel: number): string[];
  /** 2 when anything connected to an endpoint is stereo, else 1. */
  channelsInto(to: string): 1 | 2;
  /** A fresh node name. */
  allocate(base: string): string;
}

/** Convert a graph's nodes. `voice` marks them as per-voice: an instrument's. */
const convertGraph = (graph: Graph, schema: ParamSchema, voice: boolean): Conversion => {
  const taken = new Set<string>(RESERVED_NAMES);
  const allocate = (base: string) => {
    const word = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=[^A-Za-z])/, "n");
    const free = (name: string) => [name, ...SIDES.map((side) => `${name}_${side}`)].every((each) => !taken.has(each));
    const name = free(word)
      ? word
      : `${word}_${Array.from({ length: taken.size + 1 }, (_, index) => index + 2).find((index) => free(`${word}_${index}`))}`;
    [name, ...SIDES.map((side) => `${name}_${side}`)].forEach((each) => taken.add(each));
    return name;
  };
  const specs = new Map(graph.nodes.map((spec) => [spec.id, spec]));
  const names = new Map(graph.nodes.map((spec) => [spec.id, allocate(spec.id)]));
  const into = (to: string) => graph.connections.filter((connection: Connection) => connection[1] === to);

  // Which nodes carry stereo: worked out until nothing changes, since a feedback loop can carry it round.
  const stereo = new Set<string>([EFFECT_INPUT]);
  const fedStereo = (id: string) => into(id).some(([from]) => stereo.has(from));
  const carriesStereo = (spec: NodeSpec) => {
    const channels = KINDS[spec.kind].channels;
    return channels === "stereo" || (channels === "copies" && fedStereo(spec.id));
  };
  for (let changed = true; changed; ) {
    const before = stereo.size;
    graph.nodes.filter(carriesStereo).forEach((spec) => stereo.add(spec.id));
    changed = stereo.size !== before;
  }

  const copyOf = (id: string, channel: number) => `${names.get(id)}_${SIDES[channel]}`;
  const outputsOf = (id: string): string[] => {
    if (id === EFFECT_INPUT) return ["input.left", "input.right"];
    const spec = specs.get(id);
    if (!spec) return [];
    const kind = KINDS[spec.kind];
    const name = names.get(id)!;
    if (kind.outputs) return kind.outputs(name, (channel) => copyOf(id, channel), 2);
    return stereo.has(id) ? [copyOf(id, 0), copyOf(id, 1)] : [name];
  };
  const sources = (to: string, channel: number) =>
    into(to).flatMap(([from]) => {
      const outputs = outputsOf(from);
      return outputs.length === 0 ? [] : [outputs[Math.min(channel, outputs.length - 1)]];
    });

  const nodes: Record<string, DefinitionNode> = {};
  const notes: string[] = [];
  const added: ParamSpec[] = [];
  const add = (name: string, block: string, inputs: Record<string, InputValue>) =>
    void (nodes[name] = { block, ...(voice && { voice: true }), inputs });

  graph.nodes.forEach((spec) => {
    const name = names.get(spec.id)!;
    const context: KindContext = {
      name,
      voice,
      channels: fedStereo(spec.id) ? 2 : 1,
      copy: (channel) =>
        KINDS[spec.kind].channels === "copies" && !stereo.has(spec.id) ? name : copyOf(spec.id, channel),
      audioIn: (channel) => summed(sources(spec.id, channel)),
      modulators: (param, channel = 0) => sources(`${spec.id}.${param}`, channel),
      helper: (suffix) => allocate(`${name}_${suffix}`),
      add,
      note: (message) => void notes.push(message),
      addParam: (param) => {
        added.push(param);
        return param.id;
      },
      options: (param) => {
        const found = [...schema, ...added].find((each) => each.id === param);
        return found?.kind === "enum" ? found.options : [];
      },
    };
    (KINDS[spec.kind].convert as (spec: NodeSpec, context: KindContext) => void)(spec, context);
  });
  const channelsInto = (to: string) => (into(to).some(([from]) => outputsOf(from).length === 2) ? 2 : 1);
  return { nodes, notes, added, outputsOf, sources, channelsInto, allocate };
};

/**
 * What reaches an endpoint, a reference per channel: one source as it is, or a node per channel
 * summing them, times `level` when there's one.
 */
const endpoint = (
  conversion: Conversion,
  to: string,
  name: string,
  level: SingleInput = 1,
  voice = false,
): string[] => {
  const channels = conversion.channelsInto(to);
  return Array.from({ length: channels }, (_, channel) => {
    const sources = conversion.sources(to, channel);
    if (sources.length === 1 && level === 1) return sources[0];
    const node = conversion.allocate(channels === 1 ? name : `${name}_${SIDES[channel]}`);
    conversion.nodes[node] = {
      block: "mul",
      ...(voice && { voice: true }),
      inputs: { a: summed(conversion.sources(to, channel)), b: level },
    };
    return node;
  });
};

const has = (schema: ParamSchema, id: string) => schema.some((spec) => spec.id === id);

/** Left and right, or one reference for both. */
const channelsOf = (references: string[]): string | [string, string] =>
  references.length === 1 ? references[0] : [references[0], references[1]];

/**
 * An instrument: its voice graph per voice, wrapped as the old base did it. A voice into `amp` gets
 * the base's attack and release (`env.attack` and `env.release`, milliseconds); into `out`, nothing.
 */
export const instrumentFromGraph = (def: GraphInstrumentDef): Converted => {
  if (def.voice.nodes.some((spec) => spec.kind === "buffer" && spec.note !== undefined)) {
    throw new Error(
      `${def.type} plays a sample per note (a drum kit): those convert to zones with their own level and tune, which aren't in yet`,
    );
  }
  const conversion = convertGraph(def.voice, def.schema, true);
  const schema = [...def.schema, ...conversion.added];
  const time = (id: string, fallbackMs: number): SingleInput =>
    has(schema, id) ? { param: id, scale: 0.001 } : fallbackMs / 1000;
  const reaches = (to: string) => conversion.sources(to, 0).length > 0;

  const voiceOut: string[][] = [];
  if (reaches("amp")) {
    const envelope = conversion.allocate("amp_envelope");
    conversion.nodes[envelope] = {
      block: "adsr",
      voice: true,
      inputs: {
        gate: "voice.gate",
        attack: time("env.attack", 5),
        decay: 0,
        sustain: 1,
        release: time("env.release", 200),
      },
    };
    voiceOut.push(endpoint(conversion, "amp", "amp", envelope, true));
  }
  if (reaches("out")) voiceOut.push(endpoint(conversion, "out", "out", 1, true));
  const voice = mixed(conversion, voiceOut);

  const nodes = conversion.nodes;
  const output = has(schema, "amp.level")
    ? (["left", "right"].map((side) => {
        const name = conversion.allocate(`level_${side[0]}`);
        nodes[name] = { block: "mul", inputs: { a: `voices.${side}`, b: { param: "amp.level" } } };
        return name;
      }) as [string, string])
    : undefined;
  const definition: DeviceDefinition = {
    format: 1,
    voices: VOICES,
    nodes,
    ...(voice && { voice: channelsOf(voice) }),
    ...(output && { output }),
  };
  return withVoicesThatFit({ schema, definition, notes: unique(conversion.notes) });
};

/** An effect: its graph once, on the track's input, playing `wet`. */
export const effectFromGraph = (def: GraphEffectDef): Converted => {
  const conversion = convertGraph(def.graph, def.schema, false);
  const wet = conversion.sources("wet", 0).length > 0 ? endpoint(conversion, "wet", "wet") : [];
  const definition: DeviceDefinition = {
    format: 1,
    nodes: conversion.nodes,
    ...(wet.length > 0 && { output: channelsOf(wet) }),
  };
  if (wet.length === 0) conversion.notes.push("nothing reached its output, so it plays silence");
  return { schema: [...def.schema, ...conversion.added], definition, notes: unique(conversion.notes) };
};

/** The voices' outputs, `amp` and `out` added when a voice used both. */
const mixed = (conversion: Conversion, outputs: string[][]): string[] | undefined => {
  if (outputs.length < 2) return outputs[0];
  const channels = Math.max(...outputs.map((each) => each.length));
  return Array.from({ length: channels }, (_, channel) => {
    const name = conversion.allocate(channels === 1 ? "voice_out" : `voice_out_${SIDES[channel]}`);
    const [a, b] = outputs.map((each) => each[Math.min(channel, each.length - 1)]);
    conversion.nodes[name] = { block: "add", voice: true, inputs: { a, b } };
    return name;
  });
};

/** As many voices as a phone can run, up to VOICES: halved until the cost cap takes it. */
const withVoicesThatFit = (converted: Converted): Converted => {
  const fits = (voices: number) => {
    try {
      compileDefinition({ ...converted.definition, voices }, { params: converted.schema });
      return true;
    } catch (error) {
      if (error instanceof DefinitionError && error.problems.some((problem) => problem.includes("too heavy"))) {
        return false;
      }
      throw error;
    }
  };
  const voices = [VOICES, 8, 4, 2, 1].find(fits) ?? DEFAULT_VOICES;
  return voices === VOICES
    ? converted
    : {
        ...converted,
        definition: { ...converted.definition, voices },
        notes: [...converted.notes, `it plays ${voices} notes at once, as many as a phone can run`],
      };
};

const unique = (notes: string[]) => [...new Set(notes)];
