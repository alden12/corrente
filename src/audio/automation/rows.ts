/**
 * How a track's automation stacks on the timeline (DAW-67.4): each run in a row above the track,
 * packed so runs that don't overlap share one and an overlap gets another. Pure, for the timeline
 * and its tests.
 */
import type { AutomationRun } from "./playback";

/** A run and the row it sits in, 0 the top. */
export interface PackedRun {
  run: AutomationRun;
  row: number;
}

/** Each run in the first row it fits, by start (the runs as `automationRuns` sorts them). */
export function packRuns(runs: readonly AutomationRun[]): { packed: PackedRun[]; rows: number } {
  const ends: number[] = [];
  const packed = runs.map((run) => {
    const free = ends.findIndex((end) => end <= run.startBeat + 1e-9);
    const row = free === -1 ? ends.length : free;
    ends[row] = run.startBeat + run.length;
    return { run, row };
  });
  return { packed, rows: ends.length };
}

/**
 * The curve across a run as SVG points, `width` by `height` px (0 at the bottom), one sample every
 * `step` px: what a clip on the timeline draws.
 */
export function runCurve(
  sample: (clipBeat: number) => number | undefined,
  run: Pick<AutomationRun, "offset" | "length">,
  width: number,
  height: number,
  step = 2,
): string {
  if (width <= 0) return "";
  const count = Math.max(2, Math.ceil(width / step) + 1);
  return Array.from({ length: count }, (_, index) => {
    const x = (index / (count - 1)) * width;
    const value = sample(run.offset + (x / width) * run.length) ?? 0;
    return `${x.toFixed(1)},${(height - value * height).toFixed(1)}`;
  }).join(" ");
}
