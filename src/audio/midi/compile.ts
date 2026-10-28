/**
 * The MIDI device compiler (INST-11.1): a device in the MIDI format (format.ts) in, its nodes in an
 * order the engine can run (each after what it reads) with every field made a number, a param's
 * shaping or a random range; then a track's devices together as the f64 words `eng_midi_load` reads
 * (engine/src/midi/words.rs).
 *
 * A device that can't compile is refused with every problem found, each naming the node and input
 * it's about, so whoever wrote it (often an agent) can fix them all at once.
 *
 * Params reach fields as instruments' do: a number param as it is, a switch as 0 or 1, a choice (an
 * enum) as its option's index. A choice field bound to an enum param reads it by option name, and a
 * length in beats bound to a choice of divisions reads each as its beats: both become a table.
 */
import { beatsOf } from "../definitions/references";
import { paramBindingSchema, type ParamBinding } from "../definitions/format";
import type { ParamSchema, ParamSpec } from "../params/types";
import {
  MAX_COPIES,
  NODE_SPECS,
  copySchema,
  midiDefinitionSchema,
  nodeSpecNamed,
  numberFieldSchema,
  type FieldSpec,
  type MidiDefinition,
  type NumberField,
  type Wire,
} from "./format";

/** A field as the engine reads it: a number, a param through its shaping, or a random range. */
export type FieldPlan =
  | { fixed: number }
  | { param: string; scale: number; offset: number; table?: [number, number][] }
  | { random: [number, number] };

export interface PlannedNode {
  name: string;
  /** Its kind's number: its place in NODE_SPECS. */
  kind: number;
  /** Each port's sources, as places in the device's node order. */
  ports: number[][];
  fields: FieldPlan[];
}

/** A compiled device: its nodes in order, the one it plays out of, and the params it reads. */
export interface MidiDevicePlan {
  nodes: PlannedNode[];
  output: number;
  params: string[];
}

/** Every problem with a MIDI device, so they can all be fixed at once. */
export class MidiDefinitionError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The MIDI device can't be compiled:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.problems = problems;
  }
}

/** A field's plans, or the problems with it. */
type Planned = { plans: FieldPlan[] } | { problems: string[] };

const binding = (bound: ParamBinding, table?: [number, number][]): FieldPlan => ({
  param: bound.param,
  scale: bound.scale ?? 1,
  offset: bound.offset ?? 0,
  ...((table ?? bound.table) ? { table: table ?? bound.table } : {}),
});

/** A param binding checked against the device's params: the spec it reads, or a problem. */
const boundSpec = (
  bound: ParamBinding,
  where: string,
  params: ParamSchema | undefined,
): { spec?: ParamSpec } | { problem: string } => {
  if (!params) return {};
  const spec = params.find((param) => param.id === bound.param);
  if (!spec) return { problem: `${where}: there's no param ${bound.param}` };
  if (spec.kind === "sample") return { problem: `${where}: ${bound.param} is a sample, not a number` };
  return { spec };
};

/** A number field: a number in the spec's range, a param, or a random range inside it. */
const numberPlan = (
  value: unknown,
  where: string,
  range: { min: number; max: number },
  params?: ParamSchema,
): Planned => {
  const parsed = numberFieldSchema.safeParse(value);
  if (!parsed.success) return { problems: [`${where}: a number, a param binding or { "random": [min, max] }`] };
  const field: NumberField = parsed.data;
  const inRange = (number: number) => number >= range.min && number <= range.max;
  if (typeof field === "number") {
    return inRange(field)
      ? { plans: [{ fixed: field }] }
      : { problems: [`${where}: ${field} is outside ${range.min} to ${range.max}`] };
  }
  if ("random" in field) {
    const [min, max] = field.random;
    return min <= max && inRange(min) && inRange(max)
      ? { plans: [{ random: [min, max] }] }
      : { problems: [`${where}: a random range from low to high, inside ${range.min} to ${range.max}`] };
  }
  const checked = boundSpec(field, where, params);
  return "problem" in checked ? { problems: [checked.problem] } : { plans: [binding(field)] };
};

/** Each field type's plans from what an input gives (the spec's default, if it's left out). */
const FIELD_PLANS: {
  [Type in FieldSpec["type"]]: (
    spec: Extract<FieldSpec, { type: Type }>,
    value: unknown,
    where: string,
    params?: ParamSchema,
  ) => Planned;
} = {
  number: (spec, value, where, params) => numberPlan(value ?? spec.default, where, spec, params),
  choice: (spec, value = spec.default, where, params) => {
    if (typeof value === "string") {
      const index = spec.options.indexOf(value);
      return index >= 0
        ? { plans: [{ fixed: index }] }
        : { problems: [`${where}: "${value}" isn't one of ${spec.options.join(", ")}`] };
    }
    const parsed = paramBindingSchema.safeParse(value);
    if (!parsed.success) return { problems: [`${where}: one of ${spec.options.join(", ")}, or a param binding`] };
    const checked = boundSpec(parsed.data, where, params);
    if ("problem" in checked) return { problems: [checked.problem] };
    if (checked.spec?.kind !== "enum") return { plans: [binding(parsed.data)] };
    // Read by option name: each of the param's options must be one of the field's.
    const options = checked.spec.options;
    const missing = options.filter((option) => !spec.options.includes(option));
    return missing.length > 0
      ? { problems: [`${where}: ${parsed.data.param}'s ${missing.join(", ")} isn't one of ${spec.options.join(", ")}`] }
      : {
          plans: [
            binding(
              parsed.data,
              options.map((option, index) => [index, spec.options.indexOf(option)]),
            ),
          ],
        };
  },
  switch: (spec, value = spec.default, where, params) => {
    if (typeof value === "boolean") return { plans: [{ fixed: value ? 1 : 0 }] };
    const parsed = paramBindingSchema.safeParse(value);
    if (!parsed.success) return { problems: [`${where}: true, false, or a param binding`] };
    const checked = boundSpec(parsed.data, where, params);
    return "problem" in checked ? { problems: [checked.problem] } : { plans: [binding(parsed.data)] };
  },
  beats: (spec, value = spec.default, where, params) => {
    if (typeof value === "string") {
      const beats = beatsOf(value);
      return beats ? { plans: [{ fixed: beats }] } : { problems: [`${where}: "${value}" isn't a note division`] };
    }
    if (typeof value === "number")
      return value > 0 ? { plans: [{ fixed: value }] } : { problems: [`${where}: a length in beats above 0`] };
    const parsed = paramBindingSchema.safeParse(value);
    if (!parsed.success) return { problems: [`${where}: a note division ("1/8"), a number of beats, or a param`] };
    const checked = boundSpec(parsed.data, where, params);
    if ("problem" in checked) return { problems: [checked.problem] };
    if (checked.spec?.kind !== "enum") return { plans: [binding(parsed.data)] };
    // A choice of divisions: each option read as its beats.
    const options = checked.spec.options;
    const lengths = options.map((option) => beatsOf(option));
    const notDivisions = options.filter((_, index) => lengths[index] === undefined);
    return notDivisions.length > 0
      ? { problems: [`${where}: ${parsed.data.param}'s ${notDivisions.join(", ")} isn't a note division`] }
      : {
          plans: [
            binding(
              parsed.data,
              lengths.map((beats, index) => [index, beats!]),
            ),
          ],
        };
  },
  copies: (_spec, value, where, params) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COPIES)
      return { problems: [`${where}: a list of 1 to ${MAX_COPIES} copies, each { interval, velocity?, on? }`] };
    const planned = value.map((item, index): Planned => {
      const at = `${where}[${index}]`;
      const parsed = copySchema.safeParse(item);
      if (!parsed.success) return { problems: [`${at}: { interval, velocity?, on? }`] };
      const parts = [
        numberPlan(parsed.data.interval, `${at}.interval`, { min: -48, max: 48 }, params),
        numberPlan(parsed.data.velocity ?? 1, `${at}.velocity`, { min: 0, max: 4 }, params),
        FIELD_PLANS.switch({ name: "on", type: "switch", default: true }, parsed.data.on, `${at}.on`, params),
      ];
      return joined(parts);
    });
    return joined(planned);
  },
};

/** Several fields' plans in turn, or all their problems. */
const joined = (parts: Planned[]): Planned => {
  const problems = parts.flatMap((part) => ("problems" in part ? part.problems : []));
  return problems.length > 0 ? { problems } : { plans: parts.flatMap((part) => ("plans" in part ? part.plans : [])) };
};

/** Nodes in an order where each comes after what it reads, or undefined if some read each other round. */
const ordered = (reads: Record<string, string[]>): string[] | undefined => {
  const order: string[] = [];
  const placed = new Set<string>();
  // Each pass places every node whose sources are placed; a pass that places none means a loop.
  let waiting = Object.keys(reads);
  while (waiting.length > 0) {
    const ready = waiting.filter((name) => reads[name].every((source) => placed.has(source)));
    if (ready.length === 0) return undefined;
    order.push(...ready);
    ready.forEach((name) => placed.add(name));
    waiting = waiting.filter((name) => !placed.has(name));
  }
  return order;
};

/** A port's sources as names: one, or a list merged. */
const sourceNames = (value: unknown): string[] | undefined =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
      ? value
      : undefined;

/**
 * Compile a MIDI device: its nodes checked against their specs and put in order. With `params` (the
 * device's param schema), a binding to any other param is a problem.
 */
export const compileMidiDevice = (input: unknown, params?: ParamSchema): MidiDevicePlan => {
  const parsed = midiDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new MidiDefinitionError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "the device"}: ${issue.message}`),
    );
  }
  const definition: MidiDefinition = parsed.data;
  const names = Object.keys(definition.nodes);
  const problems: string[] = [];
  const specs = Object.fromEntries(names.map((name) => [name, nodeSpecNamed(definition.nodes[name].node)]));
  names
    .filter((name) => !specs[name])
    .forEach((name) =>
      problems.push(
        `${name}: there's no node "${definition.nodes[name].node}" (the palette: ${NODE_SPECS.map((spec) => spec.name).join(", ")})`,
      ),
    );
  const outputOf = (name: string): Wire | undefined => specs[name]?.output;

  // Each port's sources, checked: nodes there are, that output what the port carries.
  const portSources = Object.fromEntries(
    names.map((name) => {
      const spec = specs[name];
      const inputs = definition.nodes[name].inputs ?? {};
      if (!spec) return [name, []];
      const known = new Set([...spec.ports.map((port) => port.name), ...spec.fields.map((field) => field.name)]);
      Object.keys(inputs)
        .filter((input) => !known.has(input))
        .forEach((input) => problems.push(`${name}.${input}: a ${spec.name} has no input ${input}`));
      const ports = spec.ports.map((port) => {
        const value = inputs[port.name];
        if (value === undefined) {
          if (!port.optional) problems.push(`${name}.${port.name}: wire it to the node it reads`);
          return [];
        }
        const sources = sourceNames(value);
        if (!sources) {
          problems.push(`${name}.${port.name}: a node's name, or a list of them`);
          return [];
        }
        sources.forEach((source) => {
          if (!(source in definition.nodes)) problems.push(`${name}.${port.name}: there's no node ${source}`);
          else if (specs[source] && outputOf(source) !== port.wire)
            problems.push(`${name}.${port.name}: takes ${port.wire}, and ${source} outputs ${outputOf(source)}`);
        });
        return sources;
      });
      return [name, ports];
    }),
  ) as Record<string, string[][]>;

  // Each field's plans, in the spec's order.
  const fieldPlans = Object.fromEntries(
    names.map((name) => {
      const spec = specs[name];
      if (!spec) return [name, []];
      const inputs = definition.nodes[name].inputs ?? {};
      const planned = joined(
        spec.fields.map((field) =>
          (
            FIELD_PLANS[field.type] as (spec: FieldSpec, value: unknown, where: string, params?: ParamSchema) => Planned
          )(field, inputs[field.name], `${name}.${field.name}`, params),
        ),
      );
      if ("problems" in planned) problems.push(...planned.problems);
      return [name, "plans" in planned ? planned.plans : []];
    }),
  ) as Record<string, FieldPlan[]>;

  if (!(definition.output in definition.nodes)) problems.push(`output: there's no node ${definition.output}`);
  else if (specs[definition.output] && outputOf(definition.output) !== "notes")
    problems.push(`output: ${definition.output} outputs ${outputOf(definition.output)}, and a device plays notes`);

  const order = ordered(
    Object.fromEntries(
      names.map((name) => [name, portSources[name].flat().filter((source) => source in definition.nodes)]),
    ),
  );
  if (!order) problems.push("the nodes read each other round in a loop: a MIDI device runs each after what it reads");
  if (problems.length > 0 || !order) throw new MidiDefinitionError(problems);

  const place = new Map(order.map((name, index) => [name, index]));
  const nodes = order.map(
    (name): PlannedNode => ({
      name,
      kind: NODE_SPECS.indexOf(specs[name]!),
      ports: portSources[name].map((sources) => sources.map((source) => place.get(source)!)),
      fields: fieldPlans[name],
    }),
  );
  const read = nodes.flatMap((node) => node.fields.flatMap((field) => ("param" in field ? [field.param] : [])));
  return { nodes, output: place.get(definition.output)!, params: [...new Set(read)] };
};

/** One device of a track's chain: its plan, its params' raw values (engineValueOf), and whether it's bypassed. */
export interface ChainDevice {
  plan: MidiDevicePlan;
  values: Record<string, number>;
  bypassed: boolean;
}

/** A chain as `eng_midi_load` reads it, and what each value is: a device's param, or its bypass. */
export interface CompiledChain {
  words: Int32Array;
  values: { device: number; param?: string }[];
}

/** A field's words: 0 then a number, 1 then a value and its shaping, or 2 then a random range. */
const fieldWords = (field: FieldPlan, valueOf: (param: string) => number): number[] => {
  if ("fixed" in field) return [0, field.fixed];
  if ("random" in field) return [2, ...field.random];
  return [1, valueOf(field.param), field.scale, field.offset, field.table?.length ?? 0, ...(field.table ?? []).flat()];
};

/**
 * A track's MIDI devices, in order, as `eng_midi_load`'s words (engine/src/midi/words.rs): every
 * param each reads, and each one's bypass, is a value of its own, so a knob or a bypass moves with
 * `eng_midi_value` and nothing reloads.
 */
export const chainWords = (devices: readonly ChainDevice[]): CompiledChain => {
  const values: CompiledChain["values"] = devices.flatMap((device, index) => [
    { device: index },
    ...device.plan.params.map((param) => ({ device: index, param })),
  ]);
  const number = (device: number, param?: string) =>
    values.findIndex((value) => value.device === device && value.param === param);
  const deviceWords = devices.flatMap((device, index) => [
    1,
    number(index),
    1,
    0,
    0,
    device.plan.nodes.length,
    device.plan.output,
    ...device.plan.nodes.flatMap((node) => [
      node.kind,
      node.ports.length,
      ...node.ports.flatMap((sources) => [sources.length, ...sources]),
      node.fields.length,
      ...node.fields.flatMap((field) => fieldWords(field, (param) => number(index, param))),
    ]),
  ]);
  const raw = values.map(({ device, param }) =>
    param === undefined ? (devices[device].bypassed ? 1 : 0) : (devices[device].values[param] ?? 0),
  );
  return {
    words: new Int32Array(Float64Array.from([values.length, devices.length, ...deviceWords, ...raw]).buffer),
    values,
  };
};
