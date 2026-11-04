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
 * Chords outside the key light only as **key changes** (DAW-12.3, `chordHint`): a secondary dominant is
 * the classic doorway to a closely related key (D, V of V in C major, leads to G major), so where the
 * rules above would call it a good move, it lights in a colour of its own, and playing it offers the change.
 */
import type { ChordPad, ChordQuality } from "./chords";
import type { ProjectKey } from "./key";
import { SCALES } from "./scales";

/** How good a move is: `strong` lights brightly, `good` faintly. */
export type HintStrength = "strong" | "good";

/**
 * How a chord feels (DAW-12.4), from its quality: the colour a hint takes, the strength its depth. Four,
 * far enough apart to tell at a faint tint; a minor chord borrowed from outside the key reads dark.
 */
export type ChordMood = "bright" | "sad" | "tense" | "dark";

const QUALITY_MOODS: Record<ChordQuality, ChordMood> = {
  major: "bright",
  sixth: "bright",
  add9: "bright",
  major7: "bright",
  major9: "bright",
  power: "bright",
  minor: "sad",
  minor7: "sad",
  minorAdd9: "sad",
  minorSixth: "sad",
  minor9: "sad",
  minorMajor7: "sad",
  dominant7: "tense",
  dominant9: "tense",
  sus4: "tense",
  sus2: "tense",
  augmented: "tense",
  augmentedMajor7: "tense",
  diminished: "dark",
  halfDiminished: "dark",
  diminished7: "dark",
};

export const chordMood = (chord: ChordPad): ChordMood =>
  chord.outside && QUALITY_MOODS[chord.quality] === "sad" ? "dark" : QUALITY_MOODS[chord.quality];

/** What a pad wears after the chord last played: how good a move it is, how it feels, and whether it leads to a new key. */
export interface ChordHint {
  strength: HintStrength;
  mood: ChordMood;
  keyChange: boolean;
}

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
 * cadences are a seven-note scale's). Never a chord outside the key: those are `chordHint`'s.
 */
export const nextChordHint = (from: ChordPad, to: ChordPad, degrees: number): HintStrength | null =>
  to.outside ? null : moveHint(from, to, degrees);

/** The rules above, for any chord, in the key or not. */
function moveHint(from: ChordPad, to: ChordPad, degrees: number): HintStrength | null {
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

/** A major and a minor triad, in semitones above the root: what a new key's tonic chord is. */
const TONIC_TRIADS = { major: [0, 4, 7], minor: [0, 3, 7] } as const;

/**
 * The key a chord leads to, or null: a secondary dominant (outside the key, pulling a fifth down)
 * leads to the key of its target, major or minor as the key's own chord there is. D in C major leads
 * to G major, E to A minor. Not the key it's in: harmonic minor's own V leads home, not away.
 */
export function keyChangeTo(chord: ChordPad, key: ProjectKey): ProjectKey | null {
  if (!chord.outside || !isDominant(chord, SCALES[key.scale].length)) return null;
  const target = (chord.root + DOWN_A_FIFTH) % 12;
  const inKey = new Set(SCALES[key.scale].map((interval) => (key.tonic + interval) % 12));
  const scale = (["major", "minor"] as const).find((name) =>
    TONIC_TRIADS[name].every((interval) => inKey.has((target + interval) % 12)),
  );
  if (!scale || (target === key.tonic && scale === key.scale)) return null;
  return { tonic: target, scale };
}

/**
 * The hint `to` wears after `from` in `key`, or null: a move within the key as `nextChordHint` rates it,
 * or a chord that leads out of the key where it would be a good move from here.
 */
export function chordHint(from: ChordPad, to: ChordPad, key: ProjectKey): ChordHint | null {
  const keyChange = !!keyChangeTo(to, key);
  if (to.outside && !keyChange) return null;
  const strength = moveHint(from, to, SCALES[key.scale].length);
  return strength && { strength, mood: chordMood(to), keyChange };
}
