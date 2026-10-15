/**
 * The plan compiler (INST-36.4): a device definition (format.ts) in, the plan the engine runs out,
 * as the int32 words engine/src/plan/mod.rs reads. Every decision is made here, in testable
 * TypeScript: which section each node runs in, what feeds each input, which nodes form loops and how
 * each runs. The engine only checks the plan and follows it.
 *
 * A definition that can't compile is refused with every problem found, each naming the node and
 * input it's about, so whoever wrote it (often an agent) can fix them all at once. Most are found by
 * its schema (schema.ts); the compiler adds what each section may read.
 */
import { blockNamed, type BlockSpec } from "./catalogue";
import type { DeviceDefinition, ParamBinding } from "./format";

import { costOf, overCap, type Cost, type CostedNode } from "./cost";
import { orderSection, type Step, type StepMode } from "./loops";
import { bodyWords, SECTIONS, type Laid, type Planned } from "./words";
import type { ParamSchema } from "../params/types";
import {
  channelsOf,
  outputOf,
  referenceTo,
  sampleParamsOf,
  sourcesOf,
  underlying,
  voicesOf,
  type InputSource,
  type Source,
} from "./references";
import { definitionSchemaFor, problemsIn } from "./schema";

/** The sections a plan runs in a block: once before the voices, once per voice, once after. */
export type Section = "pre" | "voice" | "post";

/** A sample zone as the bank uses it (INST-36.6): every range filled in. */
export interface PlanZone {
  /** The sample param it plays. */
  param: string;
  root: number;
  keys: [number, number];
  velocities: [number, number];
  start: number;
  end: number;
}
/** A param source the engine keeps a smoothed buffer for: which param, and how to turn it into a value. */
export interface ParamSource {
  param: string;
  scale: number;
  offset: number;
  table?: [number, number][];
  /** A sample param: the bank sets it to the slot its sample is in, never ramping (INST-36.6). */
  sample?: true;
  /** A sample param a wavetable plays: the instrument prepares it as a table (samples/tables.ts). */
  wavetable?: true;
  /** How long a change takes to reach its value, if longer than a block: its spec's `smoothMs`. */
  smoothMs?: number;
}

export interface CompiledPlan {
  /** What eng_load reads. */
  words: Int32Array;
  /** The engine's params in order: param source i is `params[i]` of the device's params. */
  params: ParamSource[];
  /** Sample zones, in order: a note takes the first that fits. Absent without zones. */
  zones?: PlanZone[];
  voices: number;
  /** How many samples late its output is (the definition's `latency`), for the mixer to make up. */
  latency: number;
  /** What it costs to run, as shares of a phone's audio thread (cost.ts). */
  cost: Cost;
  /** Each section's steps by node name (sums show as `node.input+n`), for tests and describing. */
  steps: Record<Section, { mode: StepMode; nodes: string[] }[]>;
  /** Each section's nodes in the engine's order, so a reload can say which carry on (bank/carry.ts). */
  nodes: Record<Section, PlanNode[]>;
}

/** A node of a compiled plan: its name, and the block it runs. */
export interface PlanNode {
  name: string;
  block: string;
}

/** Every problem with a definition, so they can all be fixed at once. */
export class DefinitionError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The definition can't be compiled:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.problems = problems;
  }
}

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
  /** The device's param schema: when given, a binding to any other param, or a sample, is a problem. */
  params?: ParamSchema;
}

export const compileDefinition = (input: unknown, options: CompileOptions = {}): CompiledPlan => {
  const parsed = definitionSchemaFor(options.params).safeParse(input);
  if (!parsed.success) {
    throw new DefinitionError(problemsIn(parsed.error));
  }
  const definition = parsed.data as DeviceDefinition;
  const nodes = definition.nodes;
  const named = Object.keys(nodes);

  // Each node's sources, an input at a time: audio inputs, then controls (left out: their start).
  const blocks = Object.fromEntries(named.map((name) => [name, blockNamed(nodes[name].block)!]));
  const inputs = Object.fromEntries(
    named.map((name) => {
      const given = nodes[name].inputs ?? {};
      const ports = [...blocks[name].inputs, ...blocks[name].controls];
      return [
        name,
        ports.map((port) => sourcesOf(given[port.name] ?? ("init" in port ? port.init : 0), nodes, options.params)),
      ];
    }),
  );

  // Sections, and what each may read: the one check that needs the graph worked out.
  const flatSources = Object.fromEntries(named.map((name) => [name, inputs[name].flat().map(underlying)]));
  const sectionOf = sectionsOf(nodes, flatSources);
  const voices = voicesOf(definition);
  const voiceOut = channelsOf(definition.voice).map((reference) => referenceTo(reference, nodes) as Source);
  const trackOut = outputOf(definition).map((reference) => referenceTo(reference, nodes) as Source);
  const problems = [
    ...named.flatMap((name) => sectionProblems(name, sectionOf[name], flatSources[name], sectionOf)),
    ...sectionProblems("output", "post", trackOut, sectionOf).map((problem) =>
      problem.replace(/^output isn't a voice node, so it/, "output: the output"),
    ),
  ];
  if (problems.length > 0) throw new DefinitionError(problems);

  return plan(definition, { blocks, inputs, sectionOf, voices, voiceOut, trackOut, schema: options.params });
};

interface Resolved {
  schema?: ParamSchema;
  blocks: Record<string, BlockSpec>;
  inputs: Record<string, InputSource[][]>;
  sectionOf: Record<string, Section>;
  voices: number;
  voiceOut: Source[];
  trackOut: Source[];
}

/** The plan for a definition already checked: its nodes laid out, params numbered, sections ordered, costed, then words. */
const plan = (definition: DeviceDefinition, resolved: Resolved): CompiledPlan => {
  const planned = layOut(resolved);
  const { params, paramIndex } = paramTable(definition, resolved.schema);
  const { indices, steps } = orderSections(planned);
  const cost = costed(planned, steps, resolved.voices);
  const laid: Laid = { planned, indices, steps, ...resolved };
  const body = bodyWords(laid, paramIndex);
  const zones = definition.zones;
  // A zone's sample param is the bank's to read, so it's a param of the plan though no node reads it.
  zones?.forEach((zone) => paramIndex(zone.sample));
  // Params are numbered as the words are written, so the header, which counts them, goes on last.
  const words = Int32Array.from([params.length, resolved.voices, ...body]);
  return {
    words,
    params,
    ...(zones
      ? {
          zones: zones.map((zone) => ({
            param: zone.sample.param,
            root: zone.root,
            keys: zone.keys ?? [0, 127],
            velocities: zone.velocities ?? [0, 1],
            start: zone.start ?? 0,
            end: zone.end ?? 1,
          })),
        }
      : {}),
    voices: resolved.voices,
    latency: definition.latency ?? 0,
    cost,
    nodes: Object.fromEntries(
      SECTIONS.map((section) => [
        section,
        planned[section].map((node) => ({ name: node.name, block: node.block.name })),
      ]),
    ) as CompiledPlan["nodes"],
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

/**
 * Each section's nodes in definition order, then the nodes the compiler adds: an `add` for each
 * input summing several sources, and a `mul` and an `add` for each scaled reference.
 */
const layOut = (resolved: Resolved): Record<Section, Planned[]> => {
  const add = blockNamed("add")!;
  const mul = blockNamed("mul")!;
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
  /**
   * A scaled reference as the nodes that scale it: a `mul` (unless by a fixed 1), then an `add`
   * (unless a fixed 0). A scale or offset can be a param, read like any other.
   */
  const placed = (section: Section, label: string, source: InputSource): Source => {
    if (source.type !== "scaled") return source;
    const { scale, offset } = source;
    const scaled: Source =
      scale.type === "const" && scale.value === 1
        ? source.source
        : node(section, `${label}*`, mul, [[source.source], [scale]]);
    return offset.type === "const" && offset.value === 0
      ? scaled
      : node(section, `${label}~`, add, [[scaled], [offset]]);
  };
  const node = (section: Section, name: string, block: BlockSpec, inputs: Source[][]): Source => {
    planned[section].push({ name, block, section, inputs });
    return { type: "node", name, port: 0 };
  };
  SECTIONS.forEach((section) =>
    [...planned[section]].forEach((planNode) => {
      const ports = [...planNode.block.inputs, ...planNode.block.controls];
      planNode.inputs = resolved.inputs[planNode.name].map((sources, index) => {
        const label = `${planNode.name}.${ports[index].name}`;
        return sumOf(
          section,
          label,
          sources.map((source, position) =>
            placed(section, sources.length > 1 ? `${label}${position}` : label, source),
          ),
        );
      });
    }),
  );
  return planned;
};

/** The plan's params, each binding once: the list, and a binding's place in it, added the first time it's read. */
const paramTable = (definition: DeviceDefinition, schema: ParamSchema | undefined) => {
  const { samples: sampleParams, tables: tableParams } = sampleParamsOf(definition);
  const params: ParamSource[] = [];
  const smoothing = new Map(
    (schema ?? []).flatMap((spec) =>
      spec.kind === "number" && spec.smoothMs ? [[spec.id, spec.smoothMs] as const] : [],
    ),
  );
  const paramIndex = (binding: ParamBinding) => {
    const smoothMs = smoothing.get(binding.param);
    const source: ParamSource = {
      param: binding.param,
      scale: binding.scale ?? 1,
      offset: binding.offset ?? 0,
      ...(binding.table ? { table: binding.table } : {}),
      ...(sampleParams.has(binding.param) ? { sample: true as const } : {}),
      ...(tableParams.has(binding.param) ? { wavetable: true as const } : {}),
      ...(smoothMs ? { smoothMs } : {}),
    };
    const key = JSON.stringify(source);
    const found = params.findIndex((existing) => JSON.stringify(existing) === key);
    return found >= 0 ? found : params.push(source) - 1;
  };
  return { params, paramIndex };
};

/** Each section in order: its nodes' places by name, and the steps they run in. */
const orderSections = (planned: Record<Section, Planned[]>) => {
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
  return { indices, steps };
};

/** What a plan costs, refused if a phone couldn't run it. */
const costed = (planned: Record<Section, Planned[]>, steps: Record<Section, Step[]>, voices: number): Cost => {
  const nodesOf = (section: Section): CostedNode[] =>
    steps[section].flatMap((step) =>
      step.nodes.map((index) => ({
        block: planned[section][index].block.name,
        sampleLoop: step.mode === "sample-loop",
      })),
    );
  const cost = costOf([...nodesOf("pre"), ...nodesOf("post")], nodesOf("voice"), voices);
  const tooHeavy = overCap(cost, voices);
  if (tooHeavy) throw new DefinitionError([`${voices > 0 ? "voices" : "nodes"}: ${tooHeavy}`]);
  return cost;
};
