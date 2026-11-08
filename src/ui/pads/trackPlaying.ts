/**
 * The keys and pads as a display of what the selected track is playing (MOBILE-13), not only an input
 * to it: a clip playing back, an arpeggiator running, an octavator doubling a note all light the pads
 * they sound on. The notes come from the engine (`TrackNotes`), provided once by AppShell.
 */
import { createContext, useContext, useSyncExternalStore } from "react";
import type { TrackNotes } from "../../audio/live/trackNotes";
import type { PadNotes } from "./usePadTouch";

const TrackNotesContext = createContext<TrackNotes | null>(null);

export const TrackNotesProvider = TrackNotesContext.Provider;

const NONE: ReadonlySet<number> = new Set();
const unsubscribed = () => () => {};

/** As `PadTouch` names them, so a hook's result spreads straight into one. */
export interface TrackPlaying {
  /** The notes the track is sounding now. */
  trackNotes: ReadonlySet<number>;
  /** Whether a pad's notes are all sounding: a chord pad lights when its whole chord is playing. */
  isTrackPlaying: (pitches: PadNotes) => boolean;
}

/** What `trackId` is playing now; nothing for no track, or outside the app (a test's surface). */
export function useTrackPlaying(trackId: string | undefined): TrackPlaying {
  const store = useContext(TrackNotesContext);
  const notes = useSyncExternalStore(store?.subscribe ?? unsubscribed, () =>
    store && trackId ? store.get(trackId) : NONE,
  );
  return {
    trackNotes: notes,
    isTrackPlaying: (pitches) => pitches.length > 0 && pitches.every((pitch) => notes.has(pitch)),
  };
}
