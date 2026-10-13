/**
 * What tapping an Explore item does, wherever it is shown (a list row, a shelf card), so the two
 * never drift: an instrument or patch is tried (COMM-1.4.1), and anything else is shown in its panel
 * (`panelFor`), so nothing goes into the project from a plain tap. The "+" counts as using it
 * (COMM-1.9.7), and so does taking it from a panel (`SoundPreview.taken`, or a panel's own Add).
 */
import type { SoundPreview } from "../../audio/live/preview";
import type { ExploreItem } from "./exploreItems";
import type { LibraryActions } from "./useLibraryActions";
import { addFor, soundFor } from "./exploreActions";
import { noteUsed } from "./recent/store";

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
): ItemTaps {
  return {
    tap: (item) => {
      const sound = soundFor(item);
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
