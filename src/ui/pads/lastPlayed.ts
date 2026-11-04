/**
 * The pad or key last played, by its notes: what the next-chord hints light from (DAW-12.2) and the
 * key-change button reads (DAW-12.3). Shared, so a chord struck on the computer keyboard lights the pads
 * the same as a tap. It outlives the press: the hints are there to choose the next chord once you've let go.
 */
import { useSyncExternalStore } from "react";
import { createValueStore } from "../../listeners";
import type { ChordPad } from "../../audio/theory/chords";

const lastPlayed = createValueStore<readonly number[] | null>(null);

/** Record a pad or key played, by its notes. */
export const playedPad = (pitches: readonly number[]) => lastPlayed.set(pitches);

/** A chord's notes as pitch classes in order, so the same chord in another octave is the same chord. */
const shape = (pitches: readonly number[]) => pitches.map((pitch) => pitch % 12).join(",");

/** The chord among `pads` that was played last, in whichever octave; undefined if it isn't one of them. */
export function usePlayedChord(pads: readonly (ChordPad | null | undefined)[]): ChordPad | undefined {
  const played = useSyncExternalStore(lastPlayed.subscribe, lastPlayed.read);
  const playedShape = played && shape(played);
  return pads.find((pad): pad is ChordPad => !!pad && shape(pad.pitches) === playedShape);
}
