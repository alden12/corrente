/**
 * What tapping an Explore item does, wherever it is shown (a list row, a shelf card), so the two
 * never drift: an instrument or patch is tried (COMM-1.4.1), in the app an effect or MIDI device is
 * tried on it (`tryOn`, COMM-1.4.5), and anything else is shown in its panel (`panelFor`), so nothing
 * goes into the project from a plain tap. The "+" counts as using it (COMM-1.9.7), and so does
 * taking it from a panel or the preview.
 */
import type { SoundPreview } from "../../audio/live/preview";
import type { Sound } from "../../audio/patches/sound";
import type { ExploreItem } from "./exploreItems";
import type { LibraryActions } from "./useLibraryActions";
import type { PreviewTrying } from "../preview/previewTrying";
import { addFor, deviceToTry, soundFor } from "./exploreActions";
import { noteUsed } from "./recent/store";

/** How the app tries things: on your preview track, a device on `base` when there's none yet. */
export interface TryOn {
  trying: PreviewTrying;
  base: () => { key: string; sound: Sound };
  /** Whether an item is in the preview already: a tap on it then does nothing more. */
  isIn: (item: ExploreItem) => boolean;
}

export interface ItemTaps {
  tap: (item: ExploreItem) => void;
  /** The "+": undefined for kinds with no one-click add. */
  addFor: (item: ExploreItem) => (() => void) | undefined;
}

export function itemTaps(
  preview: SoundPreview,
  actions: LibraryActions,
  /** Wraps the "+", so the host can get out of the way after it (see `LibraryPanel`). */
  onPicked: (act: () => void) => void,
  /** Show an item in its panel under Explore (a device or a sample). */
  onShow: (item: ExploreItem) => void,
  /** The app's preview track; without it (the plugin), sounds are tried in a scratch preview. */
  tryOn?: TryOn,
): ItemTaps {
  return {
    tap: (item) => {
      const sound = soundFor(item);
      const device = deviceToTry(item);
      if (tryOn) {
        // Already in it: a second of the same is a rack's job, not a tap's.
        if (tryOn.isIn(item) && (sound || device)) return;
        // An instrument slots in under the devices tried so far; a patch brings its own chain.
        if (sound && item.source.kind === "instrument") return tryOn.trying.instrument(item.key, sound);
        if (sound) return tryOn.trying.sound(item.key, sound);
        if (device) return tryOn.trying.device(device, tryOn.base);
        return onShow(item);
      }
      if (sound) preview.open(item.key, sound);
      else {
        preview.close();
        onShow(item);
      }
    },
    addFor: (item) => {
      const add = addFor(item.source, actions);
      return (
        add &&
        (() =>
          onPicked(() => {
            add();
            noteUsed(item.key);
          }))
      );
    },
  };
}
