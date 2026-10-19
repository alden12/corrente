/**
 * The phrases a sound is heard playing when it's analysed on its own (AGENT-4.6). The ears spike
 * (AGENT-4.11) found a sound has to play something that suits its role to be judged fairly: a lead
 * playing held chords reads as a pad. So each role has its own four bars, over the same Am, F, C, G
 * so they can be compared, in beats (a quarter note each) at the project's tempo.
 */
import type { NoteEvent } from "../sequencer/types";

/** Four bars of 4/4. */
export const PHRASE_BEATS = 16;

type Note = Omit<NoteEvent, "id">;

/** The progression, a bar each: root, then the chord's notes around middle C (C4 = MIDI 60). */
const BARS = [
  { root: 45, chord: [57, 60, 64] }, // Am
  { root: 41, chord: [53, 57, 60] }, // F
  { root: 48, chord: [60, 64, 67] }, // C
  { root: 43, chord: [55, 59, 62] }, // G
];

/** Held chords, a bar each, let go just before the next so each attack shows. */
const chords = (): Note[] =>
  BARS.flatMap(({ chord }, bar) => chord.map((pitch) => ({ pitch, start: bar * 4, length: 3.75, velocity: 0.8 })));

/** Eighth notes on each bar's root, the last two an octave up, short enough to hear the release. */
const bass = (): Note[] =>
  BARS.flatMap(({ root }, bar) =>
    Array.from({ length: 8 }, (_, step) => ({
      pitch: root + (step >= 6 ? 12 : 0),
      start: bar * 4 + step / 2,
      length: 0.4,
      velocity: step % 2 === 0 ? 0.9 : 0.7,
    })),
  );

/** Up each chord an octave higher in quarters, then a long last note, so a vibrato or slow envelope shows. */
const lead = (): Note[] => [
  ...BARS.slice(0, 3).flatMap(({ chord }, bar) =>
    [...chord, chord[1]].map((pitch, step) => ({
      pitch: pitch + 12,
      start: bar * 4 + step,
      length: 0.9,
      velocity: 0.8,
    })),
  ),
  { pitch: 67, start: 12, length: 1, velocity: 0.8 },
  { pitch: 74, start: 13, length: 2.75, velocity: 0.85 },
];

/** General MIDI drums (kick 36, snare 38, closed hat 42, open hat 46): a plain backbeat. */
const beat = (): Note[] =>
  Array.from({ length: 4 }, (_, bar) => bar * 4).flatMap((barStart) => [
    { pitch: 36, start: barStart, length: 0.25, velocity: 0.95 },
    { pitch: 36, start: barStart + 2.5, length: 0.25, velocity: 0.8 },
    { pitch: 38, start: barStart + 1, length: 0.25, velocity: 0.9 },
    { pitch: 38, start: barStart + 3, length: 0.25, velocity: 0.9 },
    ...Array.from({ length: 8 }, (_, step) => ({
      pitch: barStart === 12 && step === 7 ? 46 : 42,
      start: barStart + step / 2,
      length: 0.25,
      velocity: step % 2 === 0 ? 0.7 : 0.5,
    })),
  ]);

export const PHRASES = {
  chords: { notes: chords, says: "Am, F, C, G held a bar each around middle C" },
  bass: { notes: bass, says: "eighth notes on A2, F2, C3, G2, the last two of each bar an octave up" },
  lead: { notes: lead, says: "the chords' notes an octave up in quarters, ending on a long D5" },
  beat: { notes: beat, says: "a backbeat on General MIDI kick, snare and hats" },
} as const;
export type PhraseName = keyof typeof PHRASES;
export const PHRASE_NAMES = Object.keys(PHRASES) as PhraseName[];

/** A phrase's notes, with ids. */
export const phraseNotes = (name: PhraseName): NoteEvent[] =>
  PHRASES[name].notes().map((note, index) => ({ id: `phrase-${index}`, ...note }));
