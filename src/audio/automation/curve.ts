/**
 * An automation clip's curve (DAW-67): where it is at a beat, and the tidying the store applies to
 * points it is handed. Pure, so playback, the editor, the timeline's drawing and the tools all read
 * the same curve.
 *
 * A curve is points `{beat, value}` (value 0..1), each shaping the segment to the next: a line bent
 * by `bend`, a step, or a wave (sine, triangle, saw, square) repeating every `rate` beats around the
 * line between the two points' values, `depth` either side. Before the first point the curve holds
 * the first value, after the last it holds the last, so one point is a constant.
 */
import type { AutomationClipData, AutomationPoint, AutomationShape } from "../project/types";

/** A wave's cycle when a point names none: one beat. */
export const DEFAULT_RATE = 1;
/** A wave's swing either side when a point names none. */
export const DEFAULT_DEPTH = 0.25;
/** The shortest cycle a wave may have (a 64th of a beat), so a wave can't alias into noise. */
export const MIN_RATE = 1 / 64;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A line's progress `t` (0..1) bent by `bend` (-1..1): positive rises fast then eases, negative the reverse. */
export function bent(t: number, bend = 0): number {
  if (bend === 0) return t;
  return bend > 0 ? 1 - (1 - t) ** (1 + 3 * bend) : t ** (1 - 3 * bend);
}

/** Each wave at a phase 0..1, from -1 to 1, starting at its middle and rising (the square starts high). */
const WAVES: Record<Exclude<AutomationShape, "curve" | "step">, (phase: number) => number> = {
  sine: (phase) => Math.sin(2 * Math.PI * phase),
  triangle: (phase) => 1 - 4 * Math.abs(((phase + 0.25) % 1) - 0.5),
  saw: (phase) => 2 * ((phase + 0.5) % 1) - 1,
  square: (phase) => (phase < 0.5 ? 1 : -1),
};

/** The segment from `from` to `to` at `beat`, which lies between them. */
function segmentAt(from: AutomationPoint, to: AutomationPoint, beat: number): number {
  const span = to.beat - from.beat;
  const t = span > 0 ? (beat - from.beat) / span : 1;
  const shape = from.shape ?? "curve";
  if (shape === "step") return from.value;
  if (shape === "curve") return from.value + (to.value - from.value) * bent(t, from.bend);
  const line = from.value + (to.value - from.value) * t;
  const phase = ((beat - from.beat) / (from.rate ?? DEFAULT_RATE)) % 1;
  return clamp(line + (from.depth ?? DEFAULT_DEPTH) * WAVES[shape](phase), 0, 1);
}

/**
 * The curve at `beat` (from the clip's start), 0..1; undefined for a curve with no points, which
 * drives nothing. `points` must be sorted by beat, as the store keeps them.
 */
export function valueAt(points: readonly AutomationPoint[], beat: number): number | undefined {
  if (points.length === 0) return undefined;
  if (beat <= points[0].beat) return points[0].value;
  const last = points[points.length - 1];
  if (beat >= last.beat) return last.value;
  // The last point at or before the beat; a short scan, as clips hold tens of points, not thousands.
  const index = points.findIndex((point, at) => point.beat <= beat && beat < points[at + 1].beat);
  return segmentAt(points[index], points[index + 1], beat);
}

/** Where `beat` falls in a clip that loops every `lengthBeats`. */
export const clipBeat = (lengthBeats: number, beat: number): number =>
  lengthBeats > 0 ? ((beat % lengthBeats) + lengthBeats) % lengthBeats : beat;

/** A clip's curve at a beat of its own, looping at its length. */
export const clipValueAt = (clip: Pick<AutomationClipData, "points" | "lengthBeats">, beat: number) =>
  valueAt(clip.points, clipBeat(clip.lengthBeats, beat));

/**
 * Points as the store keeps them: values in 0..1, beats in the clip, bends, rates and depths in
 * range, sorted by beat (points on the same beat keep their order, so a vertical jump survives).
 */
export function tidyPoints(points: readonly AutomationPoint[], lengthBeats: number): AutomationPoint[] {
  return points
    .map((point) => ({
      ...point,
      beat: clamp(point.beat, 0, lengthBeats),
      value: clamp(point.value, 0, 1),
      ...(point.bend !== undefined ? { bend: clamp(point.bend, -1, 1) } : {}),
      ...(point.rate !== undefined ? { rate: Math.max(MIN_RATE, point.rate) } : {}),
      ...(point.depth !== undefined ? { depth: clamp(point.depth, 0, 1) } : {}),
    }))
    .map((point, order) => ({ point, order }))
    .sort((left, right) => left.point.beat - right.point.beat || left.order - right.order)
    .map(({ point }) => point);
}
