/**
 * Which chords sound good after the one just played (DAW-12.2): lit on the pads the way a chess
 * board lights a piece's moves, so pressing pads at random drifts towards a progression. A hint, never
 * a rule: every pad still plays. Pure and DOM-free, beside chords.ts, whose pads it reads.
 *
 * **Common practice, as a few rules rather than a table per scale**, so it holds in any key and mode:
 * - **Root motion.** Down a fifth is the strongest move there is (the circle: vi ii V I). Up a fifth,
 *   down a third and up a step are good ones; pop leans on them all.
 * - **Function.** A dominant (V, a dominant seventh, a secondary dominant) wants one thing, the chord a
 *   fifth below, so that is all it lights, with V's deceptive step up to vi. A diminished chord leads up
 *   a semitone; a sus chord resolves to its own triad.
 * - **The classic cadences** in a seven-note scale: I to V, and IV to V or home to I.
 * - **The same root, another colour** (C to Cmaj7, G to G7): the harmony stays and moves inside, so the
 *   rest of the column is a good move, the same chord excepted.
 * Chords outside the key are never lit here: they are the key-change hints' (DAW-12.3).
 */
import type { ChordPad, ChordQuality } from "./chords";

/** How good a move is: `strong` lights brightly, `good` faintly. */
export type ChordHint = "strong" | "good";

/** Semitones up from one root to the next, as pitch classes: 5 is down a fifth (up a fourth). */
const UP_A_STEP = 2;
const DOWN_A_FIFTH = 5;
const UP_A_FIFTH = 7;
const DOWN_A_THIRD = [8, 9];

const DOMINANT_QUALITIES: readonly ChordQuality[] = ["dominant7", "dominant9"];
const LEADING_QUALITIES: readonly ChordQuality[] = ["diminished", "halfDiminished", "diminished7"];
const SUSPENDED_FAMILIES: readonly ChordPad["family"][] = ["sus4", "sus2"];

/** The tonic and dominant columns: a seven-note scale's degree 0 and 4. */
const TONIC = 0;
const DOMINANT = 4;
/** The cadences, by degree in a seven-note scale: I to V, and IV to V or to I (the plagal "amen"). */
const CADENCES: Record<number, readonly number[]> = { 0: [DOMINANT], 3: [TONIC, DOMINANT] };

/** A chord that pulls to the one a fifth below: V, any dominant seventh, a secondary dominant. */
const isDominant = (chord: ChordPad, degrees: number) =>
  DOMINANT_QUALITIES.includes(chord.quality) ||
  (chord.family === "flip" && chord.quality === "major") ||
  (degrees === 7 && chord.degree === DOMINANT && chord.quality === "major");

/**
 * How good `to` sounds after `from`, or null for no hint, in a scale of `degrees` notes (the
 * cadences are a seven-note scale's).
 */
export function nextChordHint(from: ChordPad, to: ChordPad, degrees: number): ChordHint | null {
  if (to.outside) return null;
  const motion = (((to.root - from.root) % 12) + 12) % 12;
  if (motion === 0) {
    if (to.family === from.family && to.quality === from.quality) return null;
    return SUSPENDED_FAMILIES.includes(from.family) && to.family === "triad" ? "strong" : "good";
  }
  if (isDominant(from, degrees)) {
    if (motion === DOWN_A_FIFTH) return "strong";
    // The deceptive cadence: V to vi, home in disguise.
    return degrees === 7 && from.degree === DOMINANT && !from.outside && motion === UP_A_STEP ? "good" : null;
  }
  if (LEADING_QUALITIES.includes(from.quality)) return motion === 1 ? "strong" : null;
  if (motion === DOWN_A_FIFTH) return "strong";
  if (degrees === 7 && !from.outside && CADENCES[from.degree]?.includes(to.degree)) return "strong";
  return motion === UP_A_FIFTH || motion === UP_A_STEP || DOWN_A_THIRD.includes(motion) ? "good" : null;
}
