/**
 * What `eng_bind` reads (ARCH-10.1): a compiled plan's param shaping and sample zones, and the params'
 * raw values, as the f64 words engine/src/router/binding.rs describes. The engine then plays notes by
 * key and params by value itself, the same in the worklet and in a native host.
 *
 * - **Values are numbered by name**: each param the plan's sources read gets one, in the order they
 *   first appear. The bank sends a param move as its value's number.
 * - **The plan's part is made once**, the first time a plan is bound, and kept with it; each load adds
 *   the values it starts from.
 * - Doubles, so the shaping's arithmetic is the TypeScript's own: what reaches the engine is the
 *   same to the bit.
 */
import type { CompiledPlan, ParamSource, PlanZone, ZoneValue } from "../definitions/compile";
import type { NumberRef } from "../params/table";
import { EMPTY_SAMPLE } from "./exports";

/** A plan's binding without the values: what every load of it shares. */
export interface PlanBinding {
  /** Each value's param name, by number. */
  names: string[];
  /** Each param name's value number. */
  numbers: Map<string, number>;
  /** Which values are sample params, starting at the empty slot rather than 0. */
  samples: boolean[];
  /** The words up to the values. */
  words: number[];
}

const shapingWords = (ref: Omit<NumberRef, "param">): number[] => [
  ref.scale ?? 1,
  ref.offset ?? 0,
  ref.table?.length ?? 0,
  ...(ref.table ?? []).flat(),
];

const sourceWords = (source: ParamSource, value: number): number[] => [
  value,
  source.sample ? 1 : 0,
  source.smoothMs ?? 0,
  ...shapingWords(source),
];

const zoneWords = (zone: PlanZone, numberOf: (param: string) => number): number[] => {
  const setting = (value: ZoneValue): number[] =>
    typeof value === "number" ? [0, value] : [1, numberOf(value.param), ...shapingWords(value)];
  return [
    numberOf(zone.param),
    ...setting(zone.root),
    ...setting(zone.keys[0]),
    ...setting(zone.keys[1]),
    ...zone.velocities,
    ...[zone.start, zone.end, zone.trimStart, zone.trimEnd, zone.tune, zone.level, zone.keytrack].flatMap(setting),
  ];
};

const bindings = new WeakMap<CompiledPlan, PlanBinding>();

/** A plan's binding, made the first time it's asked for. */
export const bindingOf = (plan: CompiledPlan): PlanBinding => {
  const known = bindings.get(plan);
  if (known) return known;
  const names = [...new Set(plan.params.map((source) => source.param))];
  const numbers = new Map(names.map((name, index) => [name, index]));
  // Every param a zone reads is one of the plan's sources (compile.ts makes it one), so it's numbered.
  const numberOf = (param: string) => numbers.get(param) ?? -1;
  const zoneParams = new Set(plan.zones?.map((zone) => zone.param));
  const samples = names.map(
    (name) => zoneParams.has(name) || plan.params.some((source) => source.param === name && source.sample === true),
  );
  const zones = plan.zones ?? [];
  const words = [
    names.length,
    plan.params.length,
    plan.zones ? 1 : 0,
    zones.length,
    ...plan.params.flatMap((source) => sourceWords(source, numberOf(source.param))),
    ...zones.flatMap((zone) => zoneWords(zone, numberOf)),
  ];
  const binding = { names, numbers, samples, words };
  bindings.set(plan, binding);
  return binding;
};

/**
 * `eng_bind`'s words for a plan: its binding, each param's raw value (from `values` by name: 0, or
 * the empty sample slot, for one not there), and where each starts if `from` names it. Doubles, as
 * pairs of int32 words.
 */
export const bindWords = (
  plan: CompiledPlan,
  values: Record<string, number>,
  from: Record<string, number> = {},
): Int32Array => {
  const { names, samples, words } = bindingOf(plan);
  const raw = names.map((name, index) => values[name] ?? (samples[index] ? EMPTY_SAMPLE : 0));
  const starts = names.map((name) => from[name] ?? NaN);
  return new Int32Array(Float64Array.from([...words, ...raw, ...starts]).buffer);
};
