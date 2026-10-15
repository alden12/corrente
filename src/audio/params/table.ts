/**
 * Params read as numbers through a lookup table (INST-17): the one way a bound value can be a
 * non-linear function of its param. A table is `[input, output]` points sorted by input; a value
 * between two points is read off the straight line joining them, and one outside the table takes
 * the nearest end. Pure and DOM-free: the engine bank, the definition format and the note path
 * share it.
 */
/** A parameter read as a number: its value, times `scale`, plus `offset`. */
export interface ParamRef {
  param: string;
  scale?: number;
  offset?: number;
}

/** One point of a lookup table: this param value in, this field value out. */
export type TablePoint = [input: number, output: number];

/**
 * A numeric parameter reference. With a `table`, the param's value is first read off it (straight
 * lines between points, the end values beyond them), then scaled and offset: the way to make a
 * value a non-linear function of a knob (INST-17).
 */
export interface NumberRef extends ParamRef {
  table?: TablePoint[];
}

/** A numeric field: a fixed value, or bound to a parameter. */
export type NumberField = number | NumberRef;

/** Read `input` off a table: piecewise-linear between points, clamped at both ends. */
export function lookupTable(points: readonly TablePoint[], input: number): number {
  const [firstInput, firstOutput] = points[0];
  if (input <= firstInput) return firstOutput;
  const upper = points.findIndex(([pointInput]) => pointInput >= input);
  if (upper === -1) return points[points.length - 1][1];
  const [fromInput, fromOutput] = points[upper - 1];
  const [toInput, toOutput] = points[upper];
  return fromOutput + ((input - fromInput) / (toInput - fromInput)) * (toOutput - fromOutput);
}

/** What is wrong with a table, or null when it is usable: two points or more, inputs ascending. */
export function tableProblem(points: readonly TablePoint[]): string | null {
  if (points.length < 2) return "a table needs at least two points";
  const ascending = points.every((point, index) => index === 0 || point[0] > points[index - 1][0]);
  return ascending ? null : "a table's inputs must be in ascending order, with no repeats";
}

/** A numeric parameter reference's value for a raw param value: read off its table if it has
 *  one, then raw*scale + offset (defaults 1, 0). */
export function resolveNumber(raw: number, ref: Omit<NumberRef, "param">): number {
  const looked = ref.table ? lookupTable(ref.table, raw) : raw;
  return looked * (ref.scale ?? 1) + (ref.offset ?? 0);
}
