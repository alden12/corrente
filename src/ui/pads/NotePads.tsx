/**
 * The keys on touch (MOBILE-6, docked by MOBILE-24): the way you play, and therefore record,
 * anything on a phone.
 *
 * **Pads, not keys**, though the section says Keys like the desktop's: you play a phrase and
 * watch it land in the roll without changing what you are looking at. They dock above the tabs,
 * outside the editor sheet, as a phone's own keyboard does, pushing the rest up: so they play
 * whether the sheet shows the roll or a device three rows down, and whatever its detent.
 *
 * Which pads depends on what you are playing: a kit gets its own pads (its notes are a
 * General MIDI map, not a key), everything else gets the scale pads.
 *
 * How many rows may show depends on the room the Studio has, not on the device, and on a share
 * of that room rather than all of it, so the arrangement and the sheet keep theirs (`fitPads`).
 */
import { useEffect } from "react";
import type { InstrumentTrack } from "../../audio/project/projectStore";
import type { SampleAsset } from "../../audio/samples/catalog";
import { SectionHeader } from "../controls/SectionHeader";
import { usePersistentBoolean } from "../usePersistent";
import { KitPads } from "./KitPads";
import { ScalePadControls, ScalePads } from "./ScalePads";
import { PAD_HEIGHT, fitPads } from "./geometry";
import { CHORDS_KEY, usePadSettings } from "./padSettings";
import { usePadTouch, type PadNoteTarget } from "./usePadTouch";

export function NotePads({
  track,
  samples,
  notes,
  octavesPerRow,
  room,
}: {
  track: InstrumentTrack;
  samples: SampleAsset[];
  /** Where the notes go - `LiveNotes`, so they reach the instrument *and* the recorder. */
  notes: PadNoteTarget;
  octavesPerRow: number;
  /** The Studio's height, keys included: what the pads share with the arrangement and the sheet. */
  room: number;
}) {
  const [open, setOpen] = usePersistentBoolean("corrente:pads-open", true);
  // Read before the settings, because how many rows fit depends on whether the accidentals
  // are taking a band above each one.
  const [accidentals] = usePersistentBoolean("corrente:pads-accidentals", true);
  const [chords] = usePersistentBoolean(CHORDS_KEY, false);
  const fit = fitPads(room, accidentals && !chords);
  const settings = usePadSettings(octavesPerRow, fit.rows);
  const touch = usePadTouch(notes);
  const isKit = track.instrumentType === "drumkit";
  const fold = { open, onToggle: () => setOpen(!open) };

  /**
   * Silence whatever is sounding when the pads go away or the track changes under them. A
   * latched note is held by nothing at all, and it routes to whichever track is selected,
   * so it must outlive neither: collapsing the section with a note held would otherwise
   * leave it ringing with nothing on screen to release it.
   */
  useEffect(() => touch.releaseAll, [touch.releaseAll, track.id, open]);

  // Nothing fits: say so, and say what to do about it. A section that silently showed a
  // clipped half-row would read as a rendering bug rather than as a screen that is too short.
  if (!isKit && fit.rows < 1)
    return (
      <>
        <SectionHeader title="Keys" fold={fold} />
        {open && <p className="px-3 py-2 text-[11px] text-faint">Turn the screen upright to play.</p>}
      </>
    );

  const controls = isKit ? undefined : (
    <ScalePadControls settings={settings} octavesPerRow={octavesPerRow} inline={fit.inlineControls} />
  );

  return (
    <>
      <SectionHeader title="Keys" fold={fold}>
        {open && fit.inlineControls && controls}
      </SectionHeader>
      {open && (
        <div className="pt-2">
          {!fit.inlineControls && controls}
          {isKit ? (
            <KitPads params={track.params} samples={samples} touch={touch} />
          ) : (
            <ScalePads settings={settings} touch={touch} octavesPerRow={octavesPerRow} padHeight={PAD_HEIGHT} />
          )}
        </div>
      )}
    </>
  );
}
