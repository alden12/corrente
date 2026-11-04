/**
 * Everything the desktop shell needs for the computer keyboard (DAW-12.1): the pads' settings, the
 * layout, the key handling and the panel's height, in one place so the shell stays a layout.
 *
 * **All four rows always play; the range control says how many are drawn.** The panel can shrink
 * to a row in the piano roll without losing a key, and the octave arrows move the whole range. In
 * chords mode it can also grow past the keyboard's four, to every chord row the key has: the rows
 * past the keys have no key, and are there to click.
 */
import { useState } from "react";
import { pitchName } from "../../audio/params/noteName";
import { pitchAt } from "../../audio/theory/scales";
import { CHORD_ROW_LIMIT, chordRows } from "../../audio/theory/chords";
import type { LiveNotes } from "../../audio/live/liveNotes";
import { OCTAVE_RANGE, usePadSettings, type PadSettings, type SongKey } from "../pads/padSettings";
import { PAD_VELOCITY, usePadTouch } from "../pads/usePadTouch";
import { usePersistentBoolean, usePersistentNumber } from "../usePersistent";
import { KEY_ROW_COUNT, keyboardRows, kitRows, octavesSpanned, padsByCode, type KeyRowMode } from "./keyLayout";
import { useKeyboardPlaying, useShiftHeld } from "./useKeyboardPlaying";
import { keysPanelHeight } from "./panelGeometry";
import type { ParamStore } from "../../audio/params/store";
import { refLabel, type SampleAsset } from "../../audio/samples/catalog";
import type { Track } from "../../audio/project/projectStore";
import { playsPads } from "../../audio/instruments/pads";
import { usePads } from "../useDrumPads";

/** A kit track's pads, which the keys play instead of notes (INST-54): its params and the project's samples, to name them. */
export interface KeysKit {
  params: ParamStore;
  samples: SampleAsset[];
}

/** The selected track as the keys play it: a kit when its instrument plays pads, else nothing. */
export const kitOf = (track: Track | undefined, samples: SampleAsset[]): KeysKit | undefined =>
  track?.kind === "instrument" && playsPads(track.params.allSpecs()) ? { params: track.params, samples } : undefined;

export function useDesktopKeys(
  liveNotes: LiveNotes,
  started: boolean,
  songKey: SongKey,
  {
    // Where the panel remembers being open, and whether it starts so: the plugin's window starts folded.
    fold = { key: "corrente:keys-open", initial: true },
    kit,
  }: { fold?: { key: string; initial: boolean }; kit?: KeysKit } = {},
) {
  const [open, setOpen] = usePersistentBoolean(fold.key, fold.initial);
  // Not persisted: a strip you set while playing, not a preference.
  const [velocity, setVelocity] = useState(PAD_VELOCITY);
  const [storedRows, setShownRows] = usePersistentNumber("corrente:keys-rows-shown", KEY_ROW_COUNT, 1, CHORD_ROW_LIMIT);
  const padSettings = usePadSettings(1, KEY_ROW_COUNT, songKey);
  // The most rows there are to draw: the keyboard's four (a kit's too), or in chords mode every row the key offers.
  const { tonic, scale, lowOctave, chordPrefs: prefs, editingChords: editing } = padSettings;
  const mostRows =
    !kit && padSettings.chords
      ? Math.max(KEY_ROW_COUNT, chordRows({ tonic, scale, lowOctave, prefs, editing }).length)
      : KEY_ROW_COUNT;
  const shownRows = Math.min(storedRows, mostRows);
  // The pads' own Accidentals switch: on, alternate rows are the accidentals, as the pads show them
  // in a band above each row; off, every row is an octave and Shift reaches the sharps.
  const rowMode: KeyRowMode = padSettings.accidentals ? "accidentals" : "octaves";
  const settings = drawnRowSettings(padSettings, shownRows, mostRows, setShownRows, octavesSpanned(rowMode));
  const touch = usePadTouch(liveNotes);
  const enabled = started && !settings.editingChords;
  // Shift turns the octave rows into their sharps (accidental rows have them already), and in chords
  // mode moves the keys up onto the four chord rows above.
  const raised = useShiftHeld(enabled && !kit && (settings.chords || rowMode === "octaves"));
  const kitPads = usePads(kit?.params).filter((pad) => pad.ref !== "" && pad.ref !== "none");

  // A kit's pads, or the notes or chords of the key.
  const rows = kit
    ? kitRows(kitPads.map((pad) => ({ note: pad.note, label: refLabel(pad.ref, kit.samples) })))
    : keyboardRows({
        tonic: settings.tonic,
        scale: settings.scale,
        lowOctave: settings.lowOctave,
        rowMode,
        raised,
        chords: settings.chords,
        prefs: settings.chordPrefs,
        editing: settings.editingChords,
      });
  const keyboard = useKeyboardPlaying({
    pads: padsByCode(rows),
    target: liveNotes,
    enabled,
    onOctave: settings.moveRange,
    velocity: () => velocity,
  });

  return {
    panel: {
      rows,
      settings,
      touch,
      keyboard,
      open,
      onToggle: () => setOpen(!open),
      shownRows,
      rowMode,
      velocity,
      onVelocity: setVelocity,
      kit: !!kit,
    },
    height: keysPanelHeight(open, shownRows),
  };
}

/**
 * The pads' settings with the range pinned to every octave the rows span and `+`/`-` sizing the
 * display instead. The low octave is clamped so the whole span fits beneath the top of the range.
 */
function drawnRowSettings(
  settings: PadSettings,
  shown: number,
  mostRows: number,
  setShown: (rows: number) => void,
  spanned: number,
): PadSettings {
  const highestLow = OCTAVE_RANGE.max - spanned;
  const lowOctave = Math.min(settings.lowOctave, highestLow);
  const canMove = (direction: -1 | 1) => (direction < 0 ? lowOctave > OCTAVE_RANGE.min : lowOctave < highestLow);
  const canSize = (direction: -1 | 1) => (direction < 0 ? shown > 1 : shown < mostRows);
  const low = pitchName(pitchAt(settings.tonic, lowOctave));
  return {
    ...settings,
    lowOctave,
    canMove,
    moveRange: (direction) => {
      if (canMove(direction)) settings.moveRange(direction);
    },
    canSize,
    sizeRange: (direction) => {
      if (canSize(direction)) setShown(shown + direction);
    },
    rangeLabel: settings.chords ? low : `${low} - ${pitchName(pitchAt(settings.tonic, lowOctave + spanned))}`,
  };
}
