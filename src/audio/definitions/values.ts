/**
 * A param's value as the engine reads it (INST-36.4): numbers as they are, a switch as 0 or 1, and a
 * choice (an enum) as its option's index, 0 first, so a table can map each choice to a value or a
 * `select` block can pick by it. Applied before a binding's table, scale and offset.
 */
import type { ParamSpec, ParamValue } from "../params/types";

export const engineValueOf = (spec: ParamSpec | undefined, value: ParamValue): number => {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return spec?.kind === "enum" ? Math.max(0, spec.options.indexOf(value)) : 0;
};
