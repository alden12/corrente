/**
 * The key change (DAW-12.3): after a chord that leads to a new key (a secondary dominant, lit coral
 * among the hints), a button in the pads' header offers the change - "→ G major" - and takes it in one
 * edit to the song's key, so it's undoable and the MIDI devices that follow the key move too. After it,
 * the chord just played is in the key, and its resolution lights as the new home.
 */
import { chordRows } from "../../audio/theory/chords";
import { keyChangeTo } from "../../audio/theory/chordMoves";
import { keyLabel } from "../../audio/theory/key";
import { CONTROL_BASE } from "../controls/tone";
import { usePlayedChord } from "./lastPlayed";
import type { PadSettings } from "./padSettings";

export function KeyChangeButton({ settings }: { settings: PadSettings }) {
  const { tonic, scale, lowOctave, chordPrefs: prefs } = settings;
  // One octave is enough to find it by: a chord played in any octave is the same chord.
  const played = usePlayedChord(chordRows({ tonic, scale, lowOctave, prefs }).flat());
  const next = played && keyChangeTo(played, { tonic, scale });
  if (!next) return null;
  const label = keyLabel(next);
  return (
    <button
      type="button"
      onClick={() => settings.setKey(next)}
      aria-label={`Change key to ${label}`}
      title={`${played.name} leads to ${label}: change the song's key`}
      className={`${CONTROL_BASE} min-w-0 h-6 px-2.5 rounded-full bg-hot/20 text-hot hover:bg-hot/30 font-mono text-[11px] truncate`}
    >
      {`→ ${label}`}
    </button>
  );
}
