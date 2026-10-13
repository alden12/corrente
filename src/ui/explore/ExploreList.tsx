/**
 * A numbered list of Explore items, wired to what taking each one does. Shared by a category
 * page, the home page's results and the library's search view, so a row behaves the same
 * wherever it turns up.
 */
import type { Dispatch } from "../../audio/commands/types";
import { removePatch } from "../../audio/patches/library";
import { ExploreRow } from "./ExploreRow";
import { itemTaps } from "./itemTaps";
import type { SoundPreview } from "../../audio/live/preview";
import type { ExploreItem, ItemSource } from "./exploreItems";
import type { LibraryActions } from "./useLibraryActions";

/**
 * Library management, for what is yours to manage: a saved patch, a project sample. Not a pick,
 * so it does not close anything. Factory presets and the catalogs have no entry.
 */
const REMOVE: Partial<
  Record<ItemSource["kind"], (source: ItemSource, dispatch: Dispatch) => { label: string; run: () => void } | undefined>
> = {
  patch: (source) =>
    source.kind === "patch" && !source.patch.builtin
      ? { label: "Delete patch", run: () => removePatch(source.patch.id) }
      : undefined,
  sample: (source, dispatch) =>
    source.kind === "sample"
      ? { label: "Remove from library", run: () => dispatch({ type: "removeSample", id: source.id }) }
      : undefined,
};

export function ExploreList({
  items,
  actions,
  dispatch,
  onPicked,
  showKind,
  preview,
  trying,
  onShow,
}: {
  items: ExploreItem[];
  actions: LibraryActions;
  dispatch: Dispatch;
  /** Wraps every pick, so the host can get out of the way after it (see `LibraryPanel`). */
  onPicked: (act: () => void) => void;
  showKind?: boolean;
  /** Where an instrument or patch opens when tapped: it is tried, not taken (COMM-1.4.1). */
  preview: SoundPreview;
  /** The key of the item being tried, so its row shows it. */
  trying: string | undefined;
  /** Show an item in its panel under Explore (an effect), rather than take it at once. */
  onShow: (item: ExploreItem) => void;
}) {
  const taps = itemTaps(preview, actions, onPicked, onShow);
  return (
    <div className="@container py-1">
      {items.map((item, index) => {
        const add = taps.addFor(item);
        return (
          <ExploreRow
            key={item.key}
            item={item}
            index={index + 1}
            showKind={showKind}
            onPick={() => taps.tap(item)}
            trying={item.key === trying}
            onAdd={add}
            onRemove={REMOVE[item.source.kind]?.(item.source, dispatch)}
          />
        );
      })}
    </div>
  );
}
