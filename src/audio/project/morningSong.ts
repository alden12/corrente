/**
 * The Morning Song (DAW-94): the opening of Strauss's *Also sprach Zarathustra* (1896; Strauss died in
 * 1949, so it is out of copyright), the sunrise the first project plays. Alden's arrangement, played
 * in on 2026-10-31 (times kept as played, to a thousandth of a beat), in three sections of eight bars,
 * the trumpet's call three times over:
 *
 * - **Sunrise:** C, G, C, a C major chord on the and of four, and the C minor answer.
 * - **Sunrise II:** the call again, answered in F, and the lead's run up into...
 * - **Sunrise III:** the climb, E-F-G twice, then A and B to the held C.
 *
 * Four parts, each a clip a section:
 *
 * - **Chords** (the Micro VA): the call and its answers.
 * - **Drums** (a Sampler on the 808 kick, pitched, with a reverb): the timpani's F and C in turn.
 * - **Pad** (with the octavator): the low notes under it all.
 * - **Lead** (the Micro VA again): the answers' top notes, the run into the climb, and the climb, in
 *   octaves.
 *
 * Each note is [pitch, start beat, length in beats, velocity 0 to 1]. 4/4 at `MORNING_TEMPO`.
 */
import type { NoteInput } from "../sequencer/clipStore";

export const MORNING_TEMPO = 110;
/** A section: eight bars, every clip's length. */
export const MORNING_SECTION = 32;
export const MORNING_BEATS = 3 * MORNING_SECTION;

type Notes = readonly (readonly [number, number, number, number])[];

/** A clip of a part: its name, its notes, and the beats it is placed at, a section each. */
export type SongClip = { name: string; notes: NoteInput[]; at: number[] };

/** Notes all starting at `start`, each [pitch, length], at one velocity. */
const together = (start: number, notes: readonly (readonly [number, number])[], velocity = 0.85): Notes =>
  notes.map(([pitch, length]) => [pitch, start, length, velocity] as const);

/** Notes a beat apart from `start`, each [pitch, length], at one velocity: the timpani's strokes. */
const strokes = (start: number, notes: readonly (readonly [number, number])[], velocity: number): Notes =>
  notes.map(([pitch, length], index) => [pitch, start + index, length, velocity] as const);

const clip = (name: string, at: number[], notes: Notes): SongClip => ({
  name,
  at,
  notes: notes.map(([pitch, start, length, velocity]) => ({ pitch, start, length, velocity })),
});

const [FIRST, SECOND, THIRD] = [0, MORNING_SECTION, 2 * MORNING_SECTION];

/** The call, C, G, C, each held to the chord on the and of four. */
const CALL: Notes = [
  [48, 0, 15, 0.85],
  [55, 4, 11, 0.85],
  [60, 8, 7, 0.85],
];

export const MORNING_CHORDS: SongClip[] = [
  clip(
    "Sunrise",
    [FIRST],
    [
      ...CALL,
      ...together(15.5, [
        [48, 0.341],
        [55, 0.33],
        [64, 0.25],
      ]),
      // ...and C minor.
      ...together(16, [
        [48, 14],
        [55, 14],
        [63, 14],
      ]),
    ],
  ),
  clip(
    "Sunrise II",
    [SECOND],
    [
      ...CALL,
      ...together(15.5, [
        [48, 0.5],
        [55, 0.5],
        [64, 0.5],
      ]),
      // ...answered in F, and F again under the lead's run.
      ...together(16, [
        [53, 7.5],
        [60, 7.5],
        [69, 7.5],
      ]),
      ...together(
        24,
        [
          [53, 7.5],
          [60, 7.5],
        ],
        0.8,
      ),
    ],
  ),
  clip(
    "Sunrise III",
    [THIRD],
    [
      ...together(0, [
        [48, 6.5],
        [55, 6.5],
      ]),
      ...together(7, [
        [48, 5.045],
        [55, 5.055],
      ]),
      ...together(12, [
        [53, 3.5],
        [60, 3.5],
      ]),
      ...together(16, [
        [55, 3.906],
        [62, 3.799],
      ]),
      ...together(20, [
        [48, 11],
        [55, 11],
      ]),
    ],
  ),
];

/** The timpani's answer, F and C in turn, a beat apart: after the first call, and under the held C. */
export const MORNING_DRUMS: SongClip[] = [
  clip(
    "Sunrise",
    [FIRST],
    [
      ...strokes(
        18,
        [
          [77, 0.756],
          [72, 0.979],
          [77, 0.883],
          [72, 1.011],
          [77, 1.171],
          [72, 1.043],
          [77, 1.203],
          [72, 1.25],
        ],
        0.85,
      ),
      ...strokes(
        26,
        [
          [77, 1],
          [72, 1],
          [77, 1],
          [72, 1],
          [77, 1],
        ],
        0.8,
      ),
    ],
  ),
  clip(
    "Sunrise III",
    [THIRD],
    [
      ...strokes(
        22,
        [
          [77, 1.171],
          [72, 1.043],
          [77, 1.203],
          [72, 1.5],
        ],
        0.85,
      ),
      ...strokes(
        26,
        [
          [77, 1.5],
          [72, 1.5],
          [77, 1.5],
          [72, 1.5],
          [77, 1.5],
        ],
        0.8,
      ),
    ],
  ),
];

/** The bass of each chord, the octavator doubling it above and below. */
export const MORNING_PAD: SongClip[] = [
  clip(
    "Sunrise",
    [FIRST],
    [
      [48, 0, 15.75, 0.85],
      [51, 16, 13, 0.8],
    ],
  ),
  clip(
    "Sunrise II",
    [SECOND],
    [
      [48, 0, 15.75, 0.85],
      [53, 16, 7.25, 0.8],
      [57, 24, 7.25, 0.8],
    ],
  ),
  clip(
    "Sunrise III",
    [THIRD],
    [
      [48, 0, 11, 0.85],
      [53, 12, 3.25, 0.8],
      [55, 16, 3.25, 0.8],
      [48, 20, 10, 0.8],
    ],
  ),
];

/** The answers' top notes, the run up out of the second section, and the climb, in octaves. */
export const MORNING_LEAD: SongClip[] = [
  clip(
    "Sunrise",
    [FIRST],
    [
      [64, 15.5, 0.5, 0.8],
      [63, 16, 14, 0.8],
    ],
  ),
  clip(
    "Sunrise II",
    [SECOND],
    [
      [64, 15.5, 0.5, 0.8],
      [69, 16, 6.25, 0.8],
      [69, 23, 0.458, 0.85],
      [71, 23.5, 0.5, 0.85],
      [72, 24, 3.75, 0.85],
      [74, 28, 3.75, 0.85],
    ],
  ),
  clip(
    "Sunrise III",
    [THIRD],
    [
      ...together(0, [
        [64, 0.25],
        [76, 0.266],
      ]),
      ...together(0.5, [
        [65, 0.266],
        [77, 0.255],
      ]),
      ...together(1, [
        [67, 5.862],
        [79, 5.843],
      ]),
      ...together(7, [
        [64, 0.25],
        [76, 0.25],
      ]),
      ...together(7.5, [
        [65, 0.25],
        [77, 0.25],
      ]),
      ...together(8, [
        [67, 3.75],
        [79, 3.75],
      ]),
      ...together(12, [
        [69, 3.75],
        [81, 3.75],
      ]),
      ...together(16, [
        [71, 3.938],
        [83, 3.895],
      ]),
      ...together(20, [
        [72, 11],
        [84, 11],
      ]),
    ],
  ),
];
