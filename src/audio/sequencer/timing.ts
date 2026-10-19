/**
 * Pure beat arithmetic shared by the live scheduler and the renders (AGENT-4.9): where notes and clip
 * onsets land, how a clip tiles across a placement. No Web Audio and no engine, so a render in Node or
 * a worker imports it without pulling in the live playback it was split from (scheduler.ts).
 */
import type { NoteEvent } from "./types";
import type { Placement } from "../project/types";

/** Pure: seconds for a number of beats at a tempo. */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/**
 * Pure: note occurrences whose onset lands in [fromBeat, toBeat), accounting for
 * the clip looping the region [loopStart, loopStart+loopLen) every loopLen beats.
 * Continuous playback beat 0 maps to loopStart, so a note at absolute beat S fires
 * at iter*loopLen + (S - loopStart). Notes outside the loop region don't play.
 * `loopStart` defaults to 0 (loop the whole clip from the top).
 */
export function notesStartingInBeatRange(
  notes: NoteEvent[],
  fromBeat: number,
  toBeat: number,
  loopLen: number,
  loopStart = 0,
): { note: NoteEvent; atBeat: number }[] {
  const result: { note: NoteEvent; atBeat: number }[] = [];
  if (loopLen <= 0 || toBeat <= fromBeat) return result;
  const startIter = Math.floor(fromBeat / loopLen);
  const endIter = Math.ceil(toBeat / loopLen);
  for (let iter = startIter; iter <= endIter; iter++) {
    const base = iter * loopLen;
    for (const note of notes) {
      if (note.start < loopStart || note.start >= loopStart + loopLen) continue;
      const at = base + (note.start - loopStart);
      if (at >= fromBeat && at < toBeat) result.push({ note, atBeat: at });
    }
  }
  return result;
}

/**
 * Pure: continuous beats at which a single onset (e.g. an audio clip's start)
 * lands in [fromBeat, toBeat), accounting for the loop region [loopStart,
 * loopStart+loopLen). Onsets outside the region don't play. `loopStart` defaults
 * to 0.
 */
export function onsetsInBeatRange(
  startBeat: number,
  fromBeat: number,
  toBeat: number,
  loopLen: number,
  loopStart = 0,
): number[] {
  const result: number[] = [];
  if (loopLen <= 0 || toBeat <= fromBeat) return result;
  if (startBeat < loopStart || startBeat >= loopStart + loopLen) return result;
  const startIter = Math.floor(fromBeat / loopLen);
  const endIter = Math.ceil(toBeat / loopLen);
  for (let iter = startIter; iter <= endIter; iter++) {
    const at = iter * loopLen + (startBeat - loopStart);
    if (at >= fromBeat && at < toBeat) result.push(at);
  }
  return result;
}

/**
 * Pure: a placement's clip notes tiled across its window, in arrangement-relative
 * beats (0 = the placement start). A clip of `clipLen` beats loops to fill the
 * window: a window that fits within the clip plays once (a trim), a longer window
 * repeats the pattern. `offset` is the phase into the loop the window begins at.
 */
export function tileClipNotes(notes: NoteEvent[], clipLen: number, offset: number, length: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  if (clipLen <= 0) return out;
  for (const note of notes) {
    if (note.start < 0 || note.start >= clipLen) continue;
    let phase = (note.start - offset) % clipLen;
    if (phase < 0) phase += clipLen;
    for (let tau = phase; tau < length; tau += clipLen) out.push({ ...note, start: tau });
  }
  return out;
}

/**
 * Pure: where in a clip an arrangement position falls, or null when no placement of that clip covers
 * it (DAW-8.9). The inverse of `tileClipNotes`: a note at clip beat `b` sounds at
 * `startBeat + ((b - offset) mod clipLen)`, so arrangement beat `position` is clip beat
 * `(position - startBeat + offset) mod clipLen`. Half-open like the scheduler, so a placement's end is
 * the next one's start rather than both.
 */
export function clipBeatAt(
  position: number,
  placements: readonly Pick<Placement, "clipId" | "startBeat" | "offset" | "length">[],
  clipId: string,
  clipLen: number,
): number | null {
  if (clipLen <= 0) return null;
  const covering = placements.find(
    (placement) =>
      placement.clipId === clipId &&
      position >= placement.startBeat &&
      position < placement.startBeat + placement.length,
  );
  if (!covering) return null;
  const phase = (position - covering.startBeat + covering.offset) % clipLen;
  return phase < 0 ? phase + clipLen : phase;
}
