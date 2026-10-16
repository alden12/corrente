/**
 * A param's value as text, the way its control shows it: a number with its unit, a note as its
 * name, a choice as itself, a switch as on or off. Shared by the controls and by a closed device's
 * summary line (DAW-61.3), so both say the same thing.
 */
import type { NumberSpec, ParamSpec, ParamValue } from "../audio/params/types";
import { pitchName } from "./noteNames";

export function formatNumber(spec: NumberSpec, value: number): string {
  if (spec.format === "note") return pitchName(value);
  const decimals = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0;
  const text = value.toFixed(decimals);
  return spec.unit ? `${text} ${spec.unit}` : text;
}

const FORMATS: Record<ParamSpec["kind"], (spec: ParamSpec, value: ParamValue) => string> = {
  number: (spec, value) => formatNumber(spec as NumberSpec, value as number),
  enum: (_spec, value) => String(value),
  boolean: (_spec, value) => (value ? "on" : "off"),
  sample: (_spec, value) => String(value),
};

export const formatParam = (spec: ParamSpec, value: ParamValue): string => FORMATS[spec.kind](spec, value);
