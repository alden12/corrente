/**
 * Pad instruments (INST-54): an instrument plays pads when its schema has pad params, `pad{n}.sample`
 * and `pad{n}.note`, a sample per pad fired by its own note. Read from the schema, the keystone, never
 * from a type name, so any kit (a second built-in, a custom one, one the agent writes) gets the pad
 * panel, the drum roll and the kit pads. DOM-free, for the agent tools too.
 */
import type { ParamSpec } from "../params/types";

/** Any of a pad's params, and its sample: the pad's number is the first group. */
export const PAD_ID = /^pad(\d+)\./;
export const PAD_SAMPLE_ID = /^pad(\d+)\.sample$/;

/** How many pads a schema declares: the highest pad number with both a sample and a note. */
export function padCount(schema: readonly ParamSpec[]): number {
  const ids = new Set(schema.map((spec) => spec.id));
  return schema
    .map((spec) => PAD_SAMPLE_ID.exec(spec.id)?.[1])
    .filter((pad): pad is string => pad !== undefined && ids.has(`pad${pad}.note`))
    .reduce((most, pad) => Math.max(most, Number(pad)), 0);
}

/** Whether an instrument with this schema plays pads rather than pitches. */
export const playsPads = (schema: readonly ParamSpec[]): boolean => padCount(schema) > 0;
