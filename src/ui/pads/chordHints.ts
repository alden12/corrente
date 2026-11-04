/**
 * The hint each chord pad or key wears after the chord last played (DAW-12.2 to 12.4), shared by the
 * phone's pads and the desktop keys so the two light the same: off with the Hints switch and while
 * arranging, and every mood green when hints are coloured by strength alone.
 */
import { chordHint, type ChordHint } from "../../audio/theory/chordMoves";
import type { ChordPad } from "../../audio/theory/chords";
import { usePlayedChord } from "./lastPlayed";
import type { PadSettings } from "./padSettings";

/** What hints are coloured by: the chord's mood, or one colour with only the strength. */
export const HINT_COLOURS = ["mood", "strength"] as const;
export type HintColours = (typeof HINT_COLOURS)[number];

/** A function from a pad on show to its hint, given every chord pad on show (to find the one played). */
export function useChordHints(
  pads: readonly (ChordPad | null | undefined)[],
  settings: PadSettings,
): (pad: ChordPad) => ChordHint | null {
  const played = usePlayedChord(pads);
  const { tonic, scale, hints, hintColours, editingChords } = settings;
  return (pad) => {
    const hint = played && hints && !editingChords ? chordHint(played, pad, { tonic, scale }) : null;
    return hint && hintColours === "strength" ? { ...hint, mood: "bright" } : hint;
  };
}
