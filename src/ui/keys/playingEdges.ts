/**
 * Where to mark the notes a track plays that no shown key holds (MOBILE-13), so nothing it plays
 * goes unseen and nothing moves to say so. Pure, for tests.
 *
 * - **Above or below the shown keys:** a line on the top edge of the top row's key in that note's
 *   column (the key with its pitch class), or the bottom edge of the bottom row's. The column says
 *   which note, the edge says which way.
 * - **Between them, with no key of its own** (a sharp, while the octave rows show only the scale):
 *   the edge of the key beside it, as a held key's sharp is marked: the right of the note below, or
 *   the left of the note above.
 */
import type { KeyCell } from "./keyLayout";

export type Side = "left" | "right" | "top" | "bottom";

interface Shown {
  code: string;
  pitch: number;
}

/** Single-note keys only: a chord pad is lit where it's played, and isn't a note to sit beside. */
const singles = (row: KeyCell[] | undefined): Shown[] =>
  (row ?? []).flatMap(({ code, pad }) => (pad?.pitches.length === 1 ? [{ code, pitch: pad.pitches[0] }] : []));

/** The key in `row` with `pitch`'s pitch class, else the one with the nearest pitch class under it. */
function columnOf(row: Shown[], pitch: number): Shown | undefined {
  const below = (key: Shown) => (((pitch - key.pitch) % 12) + 12) % 12;
  return [...row].sort((a, b) => below(a) - below(b))[0];
}

/** Marks for `playing` on the shown `rows` (bottom row first), by key code. */
export function playingEdges(rows: KeyCell[][], playing: ReadonlySet<number>): Map<string, Side[]> {
  const keys = rows.flatMap(singles);
  if (keys.length === 0 || playing.size === 0) return new Map();
  const shown = new Set(keys.map((key) => key.pitch));
  const [lowest, highest] = [Math.min(...shown), Math.max(...shown)];
  const marks = [...playing]
    .filter((pitch) => !shown.has(pitch))
    .flatMap((pitch): { code: string; side: Side }[] => {
      if (pitch > highest) {
        const key = columnOf(singles(rows.at(-1)), pitch) ?? columnOf(keys, pitch);
        return key ? [{ code: key.code, side: "top" }] : [];
      }
      if (pitch < lowest) {
        const key = columnOf(singles(rows[0]), pitch) ?? columnOf(keys, pitch);
        return key ? [{ code: key.code, side: "bottom" }] : [];
      }
      // Every key holding the neighbour, as every key holding a playing note lights.
      const below = keys.filter((key) => key.pitch === pitch - 1);
      if (below.length) return below.map((key) => ({ code: key.code, side: "right" as const }));
      return keys.filter((key) => key.pitch === pitch + 1).map((key) => ({ code: key.code, side: "left" as const }));
    });
  return marks.reduce(
    (edges, { code, side }) => new Map(edges).set(code, [...new Set([...(edges.get(code) ?? []), side])]),
    new Map<string, Side[]>(),
  );
}
