/**
 * The hint each chord pad or key wears after the chord last played (DAW-12.2 to 12.4), shared by the
 * phone's pads and the desktop keys so the two light the same: off with the Hints switch and while
 * arranging. Every hint is one green, deeper for a strong move, so the pads read as one board; the
 * chord's mood is a dot in the corner, off with the Mood dots switch (2026-11-04, Alden: four fill
 * colours on a phone were confusing).
 */
import { chordHint, keyChangeTo, type ChordHint, type ChordMood } from "../../audio/theory/chordMoves";
import type { ChordPad } from "../../audio/theory/chords";
import { keyLabel } from "../../audio/theory/key";
import { usePlayedChord } from "./lastPlayed";
import type { PadKeyChange } from "./PadButton";
import type { PadSettings } from "./padSettings";

/** What a pad wears: a hint, its mood's dot only where the dots are on. */
export type PadHint = Omit<ChordHint, "mood"> & { mood: ChordMood | null };

/** A function from a pad on show to its hint, given every chord pad on show (to find the one played). */
export function useChordHints(
  pads: readonly (ChordPad | null | undefined)[],
  settings: PadSettings,
): (pad: ChordPad) => PadHint | null {
  const played = usePlayedChord(pads);
  const { tonic, scale, hints, moodDots, editingChords } = settings;
  return (pad) => {
    const hint = played && hints && !editingChords ? chordHint(played, pad, { tonic, scale }) : null;
    return hint && { ...hint, mood: moodDots ? hint.mood : null };
  };
}

/**
 * The key change a held chord offers above it (DAW-12.3): a function from a pad to it, or null. Off with
 * the hints, as the lit doorways that lead there are.
 */
export function keyChangeFor(settings: PadSettings): (pad: ChordPad) => PadKeyChange | null {
  const { tonic, scale, hints, editingChords } = settings;
  return (pad) => {
    const next = hints && !editingChords ? keyChangeTo(pad, { tonic, scale }) : null;
    return next && { label: keyLabel(next), take: () => settings.setKey(next) };
  };
}
