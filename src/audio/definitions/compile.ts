/**
 * The plan compiler (INST-36.4): a device definition (format.ts) in, the plan the engine runs out,
 * as the int32 words engine/src/plan/mod.rs reads. Every decision is made here, in testable
 * TypeScript: which section each node runs in, what feeds each input, which nodes form loops and how
 * each runs. The engine only checks the plan and follows it.
 *
 * A definition that can't compile is refused with every problem found, each naming the node and
 * input it's about, so whoever wrote it (often an agent) can fix them all at once.
 */
import { blockNamed, type BlockSpec } from "./catalogue";
import {
  DEFAULT_VOICES,
  RESERVED_NAMES,
  TRACK_INPUTS,
  VOICE_SIGNALS,
  VOICE_SUM,
  definitionSchema,
  type DeviceDefinition,
  type InputValue,
  type ParamBinding,
} from "./format";
import { isFeedback, orderSection, type Step, type StepMode } from "./loops";

/** The sections a plan runs in a block: once before the voices, once per voice, once after. */
export type Section = "pre" | "voice" | "post";
const SECTIONS: Section[] = ["pre", "voice", "post"];

/** A param source the engine keeps a smoothed buffer for: which param, and how to turn it into a value. */
export interface ParamSource {
  param: string;
  scale: number;
  offset: number;
  table?: [number, number][];
}

export interface CompiledPlan {
  /** What eng_load reads. */
  words: Int32Array;
  /** The engine's params in order: param source i is `params[i]` of the device's params. */
  params: ParamSource[];
  voices: number;
  /** Each section's steps by node name (sums show as `node.input+n`), for tests and describing. */
  steps: Record<Section, { mode: StepMode; nodes: string[] }[]>;
}

/** Every problem with a definition, so they can all be fixed at once. */
export class DefinitionError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The definition can't be compiled:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.problems = problems;
  }
}

/** What an input reads, once its reference is understood. */
type Source =
  | { type: "node"; name: string; port: number }
  | { type: "param"; binding: ParamBinding }
  | { type: "const"; value: number }
  | { type: "voice"; signal: number }
  | { type: "voiceSum"; channel: number }
  | { type: "input"; channel: number };

/** A node of the plan: the definition's, or an `add` the compiler put in to sum an input. */
interface Planned {
  name: string;
  block: BlockSpec;
  section: Section;
  /** One list per input, audio inputs then controls; several sources are summed. */
  inputs: Source[][];
}

const signalSources: Record<string, Source> = {
  ...Object.fromEntries(Object.entries(VOICE_SIGNALS).map(([name, signal]) => [name, { type: "voice", signal }])),
  ...Object.fromEntries(Object.entries(VOICE_SUM).map(([name, channel]) => [name, { type: "voiceSum", channel }])),
  ...Object.fromEntries(Object.entries(TRACK_INPUTS).map(([name, channel]) => [name, { type: "input", channel }])),
};

const listOf = (value: InputValue) => (Array.isArray(value) ? value : [value]);

/** A reference (`osc`, `svf.highpass`, `voice.gate`) as a source, or the problem with it. */
const referenceTo = (reference: string, nodes: DeviceDefinition["nodes"]): Source | string => {
  const signal = signalSources[reference];
  if (signal) return signal;
  const [name, port, ...rest] = reference.split(".");
  const node = nodes[name];
  const block = node && blockNamed(node.block);
  if (!node || rest.length > 0) return `"${reference}" is not a node or a signal`;
  if (!block) return `"${reference}" is a ${node.block}, which isn't a block`;
  const index = port === undefined ? 0 : block.outputs.findIndex((output) => output.name === port);
  if (index < 0 || block.outputs.length === 0) {
    return `${name} (a ${node.block}) has no output "${port}" (it has ${block.outputs.map((output) => output.name).join(", ") || "none"})`;
  }
  return { type: "node", name, port: index };
};

/** One input's sources, or problems. A number into a port is checked against the port's range. */
const sourcesOf = (value: InputValue, nodes: DeviceDefinition["nodes"], range: { min: number; max: number }) =>
  listOf(value).map((item): Source | string => {
    if (typeof item === "number") {
      return item < range.min || item > range.max
        ? `${item} is outside ${range.min}..${range.max}`
        : { type: "const", value: item };
    }
    if (typeof item === "string") return referenceTo(item, nodes);
    return { type: "param", binding: item };
  });

/**
 * Which section each node runs in. Voice nodes are marked; a shared node runs after the voices if it
 * hears them (the voice sum, or another node that does), otherwise before.
 */
const sectionsOf = (nodes: DeviceDefinition["nodes"], sources: Record<string, Source[]>) => {
  const shared = Object.keys(nodes).filter((name) => !nodes[name].voice);
  const hearsVoices = (name: string, after: Set<string>) =>
    sources[name].some((source) => source.type === "voiceSum" || (source.type === "node" && after.has(source.name)));
  const grow = (after: Set<string>): Set<string> => {
    const next = new Set(shared.filter((name) => after.has(name) || hearsVoices(name, after)));
    return next.size === after.size ? after : grow(next);
  };
  const after = grow(new Set());
  return Object.fromEntries(
    Object.keys(nodes).map((name) => [name, nodes[name].voice ? "voice" : after.has(name) ? "post" : "pre"]),
  ) as Record<string, Section>;
};

/** What each section may read, as problems for anything it can't. */
const sectionProblems = (name: string, section: Section, sources: Source[], sectionOf: Record<string, Section>) =>
  sources.flatMap((source) => {
    if (source.type === "voice" && section !== "voice")
      return [`${name} isn't a voice node, so it can't read a voice's signals`];
    if (source.type === "voiceSum" && section === "voice")
      return [`${name} is a voice node, so it can't hear the voices summed`];
    if (source.type !== "node") return [];
    const from = sectionOf[source.name];
    if (section !== "voice" && from === "voice") {
      return [
        `${name} isn't a voice node, so it can't read ${source.name}, which is: read voices.left and voices.right, the voices summed`,
      ];
    }
    if (section === "voice" && from === "post")
      return [`${name} is a voice node, so it can't read ${source.name}, which runs after the voices`];
    return [];
  });

export interface CompileOptions {
  /** The device's params: when given, a binding to any other param is a problem. */
  params?: string[];
}

export const compileDefinition = (input: unknown, options: CompileOptions = {}): CompiledPlan => {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new DefinitionError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "the definition"}: ${issue.message}`),
    );
  }
  const definition = parsed.data;
  const nodes = definition.nodes;
  const problems: string[] = [];

  // Each node's block and inputs: audio inputs must be wired, controls default to their start.
  const blocks: Record<string, BlockSpec> = {};
  const inputs: Record<string, Source[][]> = {};
  Object.entries(nodes).forEach(([name, node]) => {
    if (RESERVED_NAMES.includes(name))
      return problems.push(`${name}: the name is kept for signals (${RESERVED_NAMES.join(", ")})`);
    const block = blockNamed(node.block);
    if (!block) return problems.push(`${name}: there is no block "${node.block}"`);
    blocks[name] = block;
    const ports = [...block.inputs, ...block.controls];
    const given = node.inputs ?? {};
    Object.keys(given)
      .filter((port) => !ports.some((candidate) => candidate.name === port))
      .forEach((port) =>
        problems.push(
          `${name}: a ${node.block} has no input "${port}" (it has ${ports.map((candidate) => candidate.name).join(", ") || "none"})`,
        ),
      );
    block.inputs
      .filter((port) => given[port.name] === undefined)
      .forEach((port) =>
        problems.push(`${name}.${port.name}: not wired (every audio input needs a value, a param or a connection)`),
      );
    inputs[name] = ports.map((port) => {
      const value = given[port.name] ?? ("init" in port ? port.init : 0);
      const resolved = sourcesOf(value, nodes, port);
      resolved
        .filter((source) => typeof source === "string")
        .forEach((problem) => problems.push(`${name}.${port.name}: ${problem}`));
      return resolved.filter((source): source is Source => typeof source !== "string");
    });
  });
  const allParams = Object.values(inputs)
    .flat(2)
    .filter((source) => source.type === "param");
  if (options.params) {
    allParams
      .filter((source) => !options.params!.includes(source.binding.param))
      .forEach((source) =>
        problems.push(
          `there is no param "${source.binding.param}" (the device has ${options.params!.join(", ") || "none"})`,
        ),
      );
  }

  const named = Object.keys(blocks);
  const flatSources = Object.fromEntries(named.map((name) => [name, inputs[name].flat()]));
  const sectionOf = sectionsOf(Object.fromEntries(named.map((name) => [name, nodes[name]])), flatSources);
  named.forEach((name) => problems.push(...sectionProblems(name, sectionOf[name], flatSources[name], sectionOf)));

  // The outputs: what each voice plays, and what the track plays.
  const voiceNodes = named.filter((name) => sectionOf[name] === "voice");
  const voices = definition.voices ?? (voiceNodes.length > 0 ? DEFAULT_VOICES : 0);
  const channels = (value: string | [string, string] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  const voiceOut = channels(definition.voice).map((reference) => referenceTo(reference, nodes));
  const trackOut = channels(definition.output ?? (voices > 0 ? ["voices.left", "voices.right"] : undefined)).map(
    (reference) => referenceTo(reference, nodes),
  );
  [...voiceOut, ...trackOut]
    .filter((source) => typeof source === "string")
    .forEach((problem) => problems.push(`output: ${problem}`));
  if (voiceNodes.length > 0 && voiceOut.length === 0)
    problems.push("voice: the voices play nothing (name what each voice plays)");
  if (voiceNodes.length > 0 && voices === 0) problems.push("voices: there are voice nodes but no voices");
  if (voiceNodes.length === 0 && definition.voice !== undefined)
    problems.push("voice: there are no voice nodes to play");
  if (trackOut.length === 0) problems.push("output: the track plays nothing (name its output)");
  voiceOut.forEach((source) => {
    if (typeof source !== "string" && (source.type !== "node" || sectionOf[source.name] !== "voice"))
      problems.push("voice: each voice plays a voice node's output");
  });
  trackOut.forEach((source) => {
    if (typeof source !== "string")
      problems.push(
        ...sectionProblems("output", "post", [source], sectionOf).map((problem) =>
          problem.replace(/^output isn't a voice node, so it/, "the output"),
        ),
      );
  });
  if (problems.length > 0) throw new DefinitionError(problems);

  return plan(definition, {
    blocks,
    inputs,
    sectionOf,
    voices,
    voiceOut: voiceOut as Source[],
    trackOut: trackOut as Source[],
  });
};

interface Resolved {
  blocks: Record<string, BlockSpec>;
  inputs: Record<string, Source[][]>;
  sectionOf: Record<string, Section>;
  voices: number;
  voiceOut: Source[];
  trackOut: Source[];
}

/** The plan for a definition already checked: sections, sums, order, then words. */
const plan = (definition: DeviceDefinition, resolved: Resolved): CompiledPlan => {
  const add = blockNamed("add")!;
  // Each section's nodes in definition order, then the adds that sum their inputs.
  const planned: Record<Section, Planned[]> = { pre: [], voice: [], post: [] };
  Object.keys(resolved.blocks).forEach((name) => {
    planned[resolved.sectionOf[name]].push({
      name,
      block: resolved.blocks[name],
      section: resolved.sectionOf[name],
      inputs: [],
    });
  });
  const sumOf = (section: Section, label: string, sources: Source[]): Source[] =>
    sources.length < 2
      ? sources
      : [
          sources.slice(1).reduce((total, source, position) => {
            const name = `${label}+${position + 1}`;
            planned[section].push({ name, block: add, section, inputs: [[total], [source]] });
            return { type: "node", name, port: 0 };
          }, sources[0]),
        ];
  SECTIONS.forEach((section) =>
    [...planned[section]].forEach((node) => {
      const ports = [...node.block.inputs, ...node.block.controls];
      node.inputs = resolved.inputs[node.name].map((sources, index) =>
        sumOf(section, `${node.name}.${ports[index].name}`, sources),
      );
    }),
  );

  // Params, each binding once.
  const params: ParamSource[] = [];
  const paramIndex = (binding: ParamBinding) => {
    const source: ParamSource = {
      param: binding.param,
      scale: binding.scale ?? 1,
      offset: binding.offset ?? 0,
      ...(binding.table ? { table: binding.table } : {}),
    };
    const key = JSON.stringify(source);
    const found = params.findIndex((existing) => JSON.stringify(existing) === key);
    return found >= 0 ? found : params.push(source) - 1;
  };

  // Order each section.
  const indexIn = (section: Section) => new Map(planned[section].map((node, index) => [node.name, index]));
  const indices = Object.fromEntries(SECTIONS.map((section) => [section, indexIn(section)])) as Record<
    Section,
    Map<string, number>
  >;
  const steps = Object.fromEntries(
    SECTIONS.map((section) => {
      const own = indices[section];
      const order = planned[section].map((node) => {
        const reads = node.inputs
          .flat()
          .flatMap((source) => (source.type === "node" && own.has(source.name) ? [own.get(source.name)!] : []));
        const length = node.block.name === "delay" ? node.inputs[1][0] : undefined;
        return {
          reads,
          ...(node.block.name === "delay"
            ? { delayLength: length?.type === "node" && own.has(length.name) ? own.get(length.name)! : null }
            : {}),
        };
      });
      return [section, orderSection(order)];
    }),
  ) as Record<Section, Step[]>;

  // The words.
  const floatBits = (value: number) => new Int32Array(Float32Array.of(value).buffer)[0];
  const stepOf = (section: Section, node: number) => steps[section].find((step) => step.nodes.includes(node))!;
  /** One source as (type, index, extra), read from `section` by node `reader` (-1 for an output). */
  const encoders: {
    [Type in Source["type"]]: (source: Extract<Source, { type: Type }>, section: Section, reader: number) => number[];
  } = {
    node: (source, section, reader) => {
      const from = resolved.sectionOf[source.name] ?? section;
      const index = indices[from].get(source.name)!;
      if (from !== section) return [5, index, source.port];
      const feedback = reader >= 0 && isFeedback(stepOf(section, reader), reader, index);
      return [feedback ? 1 : 0, index, source.port];
    },
    param: (source) => [2, paramIndex(source.binding), 0],
    const: (source) => [3, 0, floatBits(source.value)],
    voice: (source) => [4, source.signal, 0],
    voiceSum: (source) => [6, source.channel, 0],
    input: (source) => [7, source.channel, 0],
  };
  const encode = (source: Source, section: Section, reader: number) =>
    (encoders[source.type] as (source: Source, section: Section, reader: number) => number[])(source, section, reader);
  const sectionWords = (section: Section) => [
    planned[section].length,
    steps[section].length,
    ...planned[section].flatMap((node, index) => [
      node.block.kind,
      node.block.inputs.length,
      node.block.controls.length,
      ...node.inputs.flatMap((sources) => encode(sources[0], section, index)),
    ]),
    ...steps[section].flatMap((step) => [
      { node: 0, "sample-loop": 1, "chunk-loop": 2 }[step.mode],
      step.nodes.length,
      ...step.nodes,
    ]),
  ];
  const body = [
    ...SECTIONS.flatMap(sectionWords),
    resolved.voiceOut.length,
    ...resolved.voiceOut.flatMap((source) => encode(source, "voice", -1)),
    resolved.trackOut.length,
    ...resolved.trackOut.flatMap((source) => encode(source, "post", -1)),
  ];
  // Params are numbered as the words are written, so the header, which counts them, goes on last.
  const words = Int32Array.from([params.length, resolved.voices, definition.latency ?? 0, ...body]);
  return {
    words,
    params,
    voices: resolved.voices,
    steps: Object.fromEntries(
      SECTIONS.map((section) => [
        section,
        steps[section].map((step) => ({
          mode: step.mode,
          nodes: step.nodes.map((node) => planned[section][node].name),
        })),
      ]),
    ) as CompiledPlan["steps"],
  };
};
