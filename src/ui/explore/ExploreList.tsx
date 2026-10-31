/**
 * A numbered list of Explore items, wired to what taking each one does. Shared by a category
 * page, the home page's results and the library's search view, so a row behaves the same
 * wherever it turns up.
 */
import type { Dispatch } from "../../audio/commands/types";
import { removePatch } from "../../audio/patches/library";
import { ExploreRow } from "./ExploreRow";
import type { ItemTaps } from "./itemTaps";
import type { TryingMark } from "./exploreActions";
import type { ExploreItem, ItemSource } from "./exploreItems";

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
  dispatch,
  showKind,
  taps,
  trying,
}: {
  items: ExploreItem[];
  dispatch: Dispatch;
  showKind?: boolean;
  /** What tapping a row and its "+" do (`itemTaps`). */
  taps: ItemTaps;
  /** Whether an item is in the preview or its panel, so its row shows it. */
  trying: (item: ExploreItem) => TryingMark;
}) {
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
            trying={trying(item)}
            onAdd={add}
            onRemove={REMOVE[item.source.kind]?.(item.source, dispatch)}
          />
        );
      })}
    </div>
  );
}
