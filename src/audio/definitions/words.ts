/**
 * A compiled plan as the int32 words engine/src/plan/mod.rs reads (INST-36.4): each section's nodes,
 * what feeds each input and the steps they run in, then the voice's and the track's outputs. Only
 * the encoding: every decision was made before (compile.ts).
 */
import type { BlockSpec } from "./catalogue";
import type { Section } from "./compile";
import { isFeedback, type Step, type StepMode } from "./loops";
import type { ParamBinding } from "./format";
import type { Source } from "./references";

/** The sections a plan runs in a block, in order: once before the voices, once per voice, once after. */
export const SECTIONS: Section[] = ["pre", "voice", "post"];

/** A node of the plan: the definition's, or one the compiler put in to sum or scale an input. */
export interface Planned {
  name: string;
  block: BlockSpec;
  section: Section;
  /** One list per input, audio inputs then controls; several sources are summed. */
  inputs: Source[][];
}

/**
 * How the words name what an input reads, and how a step runs: engine/src/plan/mod.rs reads these
 * numbers, so they change together.
 */
export const INPUT_TYPE = {
  /** A node in the same section, this block: (node, port). */
  buffer: 0,
  /** A node in the same section, the sample before (a feedback edge): (node, port). */
  previous: 1,
  /** A param source: (index). */
  param: 2,
  /** A fixed number: (0, its f32 bits). */
  constant: 3,
  /** A voice signal: (signal). */
  voice: 4,
  /** A node in the pre section, read from a later one: (node, port). */
  shared: 5,
  /** The voices summed: (channel). */
  voiceSum: 6,
  /** The track's audio input: (channel). */
  input: 7,
  /** A host signal: (signal). */
  host: 8,
} as const;
export const STEP_MODE: Record<StepMode, number> = { node: 0, "sample-loop": 1, "chunk-loop": 2 };

export interface Laid {
  planned: Record<Section, Planned[]>;
  /** Each section's nodes' places in it, by name. */
  indices: Record<Section, Map<string, number>>;
  steps: Record<Section, Step[]>;
  /** The section each of the definition's nodes runs in (the compiler's own are in their section's list). */
  sectionOf: Record<string, Section>;
  voiceOut: Source[];
  trackOut: Source[];
}

/** The words after the header: each section, then the outputs. `paramIndex` numbers each param read. */
export const bodyWords = (laid: Laid, paramIndex: (binding: ParamBinding) => number): number[] => {
  const { planned, indices, steps, sectionOf } = laid;
  const floatBits = (value: number) => new Int32Array(Float32Array.of(value).buffer)[0];
  const stepOf = (section: Section, node: number) => steps[section].find((step) => step.nodes.includes(node))!;
  /** One source as (type, index, extra), read from `section` by node `reader` (-1 for an output). */
  const encoders: {
    [Type in Source["type"]]: (source: Extract<Source, { type: Type }>, section: Section, reader: number) => number[];
  } = {
    node: (source, section, reader) => {
      const from = sectionOf[source.name] ?? section;
      const index = indices[from].get(source.name)!;
      if (from !== section) return [INPUT_TYPE.shared, index, source.port];
      const feedback = reader >= 0 && isFeedback(stepOf(section, reader), reader, index);
      return [feedback ? INPUT_TYPE.previous : INPUT_TYPE.buffer, index, source.port];
    },
    param: (source) => [INPUT_TYPE.param, paramIndex(source.binding), 0],
    const: (source) => [INPUT_TYPE.constant, 0, floatBits(source.value)],
    voice: (source) => [INPUT_TYPE.voice, source.signal, 0],
    voiceSum: (source) => [INPUT_TYPE.voiceSum, source.channel, 0],
    input: (source) => [INPUT_TYPE.input, source.channel, 0],
    host: (source) => [INPUT_TYPE.host, source.signal, 0],
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
    ...steps[section].flatMap((step) => [STEP_MODE[step.mode], step.nodes.length, ...step.nodes]),
  ];
  return [
    ...SECTIONS.flatMap(sectionWords),
    laid.voiceOut.length,
    ...laid.voiceOut.flatMap((source) => encode(source, "voice", -1)),
    laid.trackOut.length,
    ...laid.trackOut.flatMap((source) => encode(source, "post", -1)),
  ];
};
