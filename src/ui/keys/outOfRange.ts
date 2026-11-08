/**
 * Which way the track is playing notes the keys don't show (MOBILE-13), so the panel can say so
 * rather than light nothing and leave "why is nothing lighting" a mystery. Pure, for tests.
 */
import type { KeyCell } from "./keyLayout";

/** Whether any of `playing` is above or below every note on the shown rows. */
export function outOfRange(playing: ReadonlySet<number>, rows: KeyCell[][]): { above: boolean; below: boolean } {
  const shown = rows.flatMap((row) => row.flatMap((cell) => cell.pad?.pitches ?? []));
  if (playing.size === 0 || shown.length === 0) return { above: false, below: false };
  const [lowest, highest] = [Math.min(...shown), Math.max(...shown)];
  const notes = [...playing];
  return { above: notes.some((note) => note > highest), below: notes.some((note) => note < lowest) };
}
