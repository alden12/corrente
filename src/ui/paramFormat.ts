/** A number param's value as text, the way its control shows it: with its unit, or a note as its name. */
import type { NumberSpec } from "../audio/params/types";
import { pitchName } from "./noteNames";

export function formatNumber(spec: NumberSpec, value: number): string {
  if (spec.format === "note") return pitchName(value);
  const decimals = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0;
  const text = value.toFixed(decimals);
  return spec.unit ? `${text} ${spec.unit}` : text;
}
