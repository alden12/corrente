/**
 * A track's notes, and an audio track's clip triggers, as a render plays them (AGENT-4.9): its placements tiled into the arrangement's
 * region, in seconds from the region's start, with the project's groove nudging each onset and
 * velocity as the live scheduler does (Scheduler.tick). The region plays once, which is the
 * arrangement; live playback just loops it. Shared by every render, so they all hear the same notes.
 */
import type { AudioTrack, InstrumentTrack } from "../project/projectStore";
import type { AudioClipData } from "../project/types";
import { GRID, type NoteEvent } from "../sequencer/types";
import { beatsToSeconds, tileClipNotes } from "../sequencer/scheduler";
import { grooveById } from "../grooves/catalog";
import { grooveAt } from "../sequencer/groove";
import { clamp } from "../../util";

/** The part of a project the notes depend on: its tempo, region and groove. */
export interface Timeline {
  tempo: number;
  loopStart: number;
  length: number;
  groove: { id: string; amount: number };
}

/** A note to play, in seconds from the start of the render. */
export interface ScheduledNote {
  pitch: number;
  start: number;
  length: number;
  velocity: number;
}

/** A track's notes within [loopStart, length), each at its absolute beat. */
export function arrangementNotes(
  track: InstrumentTrack,
  loopStart: number,
  length: number,
): { note: NoteEvent; atBeat: number }[] {
  return track.placements.flatMap((placement) => {
    const clip = track.clips.find((entry) => entry.id === placement.clipId);
    if (!clip) return [];
    const { notes, lengthBeats } = clip.store.getClip();
    return tileClipNotes(notes, lengthBeats, placement.offset, placement.length)
      .map((note) => ({ note, atBeat: placement.startBeat + note.start }))
      .filter(({ atBeat }) => atBeat >= loopStart && atBeat < length);
  });
}

/** A track's notes in seconds from the region's start, grooved. */
export function trackNotes(track: InstrumentTrack, { tempo, loopStart, length, groove }: Timeline): ScheduledNote[] {
  const feel = grooveById(groove.id);
  return arrangementNotes(track, loopStart, length).map(({ note, atBeat }) => {
    const shift = grooveAt(feel, atBeat, groove.amount);
    return {
      pitch: note.pitch,
      start: Math.max(0, beatsToSeconds(atBeat - loopStart + shift.offsetBeats, tempo)),
      length: beatsToSeconds(note.length, tempo),
      velocity: clamp(note.velocity * shift.velocityScale, 0, 1),
    };
  });
}

/** An audio clip to play: its loop region from `start` (seconds from the region's start), cut off after `maxSec`. */
export interface AudioTrigger {
  clip: AudioClipData;
  start: number;
  maxSec: number;
}

/**
 * An audio track's clip triggers within [loopStart, length): each placement plays its clip's loop
 * region from its start, and again every region-length to fill it, as the live scheduler does
 * (Scheduler.tick). Each is cut off at the arrangement's end rather than left ringing past it.
 */
export function audioTriggers(track: AudioTrack, { tempo, loopStart, length }: Timeline): AudioTrigger[] {
  return track.placements.flatMap((placement) => {
    const clip = track.clips.find((entry) => entry.id === placement.clipId);
    if (!clip || placement.length <= 0) return [];
    const regionSec = (clip.loopEndSec ?? clip.durationSec) - (clip.loopStartSec ?? 0);
    const stepBeats = regionSec > 0 ? Math.max(GRID, (regionSec * tempo) / 60) : Infinity;
    return Array.from({ length: Math.max(1, Math.ceil(placement.length / stepBeats)) }, (_, index) => {
      return placement.startBeat + index * stepBeats;
    })
      .filter((atBeat) => atBeat >= loopStart && atBeat < length)
      .map((atBeat) => ({
        clip,
        start: beatsToSeconds(atBeat - loopStart, tempo),
        maxSec: beatsToSeconds(length - atBeat, tempo),
      }));
  });
}
