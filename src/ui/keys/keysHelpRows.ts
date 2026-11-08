/** The Keys header's shortcut list (`KeysHelp`), pure for tests. */
import type { KeyRowMode } from "./keyLayout";

/** A key or chord of keys, and what it does: what the list shows, by what the keys play. */
export function keysHelpRows({
  kit,
  chords,
  rowMode,
  mac,
}: {
  kit: boolean;
  chords: boolean;
  rowMode: KeyRowMode;
  mac: boolean;
}): [keys: string, does: string][] {
  if (kit)
    return [
      ["Z X C ...", "The kit's pads, in order"],
      ["Space", "Play / stop"],
    ];
  return [
    ...(chords
      ? ([["Shift", "Chord rows 5-8"], ...(mac ? [["⌃ Ctrl + Shift", "Chord rows 9-12"]] : [])] as [string, string][])
      : rowMode === "octaves"
        ? ([["Shift", "Each note's sharp"]] as [string, string][])
        : []),
    ["Tab (held)", "Sustain pedal"],
    ["[  ]", "Octave down / up"],
    ["Space", "Play / stop"],
  ];
}
