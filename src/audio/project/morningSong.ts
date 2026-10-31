/**
 * The Morning Song (DAW-94): the opening of Strauss's *Also sprach Zarathustra* (1896; Strauss died in
 * 1949, so it is out of copyright), the sunrise the first project plays. Alden's arrangement, played
 * in on 2026-10-31 (times kept as played, to a thousandth of a beat):
 *
 * - **Lead** (the Micro VA): the call, C, G, C, held under a C major chord on the and of four, then the
 *   orchestra's C minor answer held through the second half.
 * - **Timpani** (a Sampler on the 808 kick, pitched, with a reverb): the answer, F and C in turn.
 * - **Pad** (with the octavator): the low C under it all, quieter for the second half.
 *
 * Each part is [pitch, start beat, length in beats, velocity 0 to 1]. 4/4 at `MORNING_TEMPO`.
 */
import type { NoteInput } from "../sequencer/clipStore";

export const MORNING_TEMPO = 110;
export const MORNING_BEATS = 28;

type Part = readonly (readonly [number, number, number, number])[];

/** A chord's pitches, all starting at `start`, each held its own length. */
const chord = (start: number, notes: readonly (readonly [number, number])[]): Part =>
  notes.map(([pitch, length]) => [pitch, start, length, 0.85] as const);

const LEAD: Part = [
  // The call: C, G, C, each held on into the chord.
  [48, 0, 15.245, 0.85],
  [55, 4, 11.228, 0.85],
  [60, 8, 7.354, 0.85],
  // C major, short, on the and of four...
  ...chord(15.5, [
    [48, 0.341],
    [55, 0.33],
    [60, 0.341],
    [64, 0.25],
    [67, 0.33],
    [76, 0.25],
  ]),
  // ...and C minor, held to the end.
  ...chord(16, [
    [48, 11.462],
    [55, 11.43],
    [60, 11.462],
    [63, 11.526],
    [67, 11.43],
    [75, 11.526],
  ]),
];

/** The timpani's answer on the pitched 808 kick: F and C in turn, a beat apart. */
const TIMPANI: Part = [
  [77, 18, 0.756, 0.85],
  [72, 19, 0.979, 0.85],
  [77, 20, 0.883, 0.85],
  [72, 21, 1.011, 0.85],
  [77, 22, 1.171, 0.85],
  [72, 23, 1.043, 0.85],
  [77, 24, 1.203, 0.85],
  [72, 25, 1.831, 0.85],
];

/** The low C, the octavator doubling it above and below. */
const PAD: Part = [
  [48, 0, 15.75, 0.85],
  [48, 16, 12, 0.461],
];

const notes = (part: Part): NoteInput[] =>
  part.map(([pitch, start, length, velocity]) => ({ pitch, start, length, velocity }));

export const MORNING_LEAD = notes(LEAD);
export const MORNING_TIMPANI = notes(TIMPANI);
export const MORNING_PAD = notes(PAD);
