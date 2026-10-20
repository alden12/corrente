/**
 * One Explore item as a playlist row (COMM-1.9.1): number, artwork, name and tags, then its
 * actions. The whole left side is the primary tap (audition it on the selected track); the heart
 * favourites it (COMM-1.9.3), the "+" adds a new track, and the menu removes what is yours to
 * remove.
 */
import { Menu } from "../Menu";
import { ExploreThumb } from "./ExploreThumb";
import { CATEGORIES, type ExploreItem } from "./exploreItems";
import { ADD_HINT, PICK_HINT } from "./exploreActions";
import { FavouriteButton } from "./favourites/FavouriteButton";

export function ExploreRow({
  item,
  index,
  showKind,
  onPick,
  onAdd,
  onRemove,
  trying,
}: {
  item: ExploreItem;
  /** The row's number in its list, from 1. */
  index: number;
  /** Mixed results say which category each row is from. */
  showKind?: boolean;
  onPick: () => void;
  onAdd?: () => void;
  onRemove?: { label: string; run: () => void };
  /** It is the sound in the try panel. */
  trying?: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-1 pr-2 hover:bg-you/10 ${trying ? "bg-you/15" : ""}`}
      data-testid="explore-row"
    >
      <button
        type="button"
        // Let go of focus once tapped: trying a sound hands the keys to it, and a focused row would
        // show a focus ring and take Space and Enter as another tap.
        onClick={(event) => {
          event.currentTarget.blur();
          onPick();
        }}
        aria-current={trying ? "true" : undefined}
        // Named for the device alone: the number, badge and tags are for the eye.
        aria-label={item.name}
        title={PICK_HINT[item.source.kind](item.name)}
        className="flex-1 min-w-0 flex items-center gap-2.5 pl-2 py-1.5 text-left cursor-pointer"
      >
        {/* The number gives way first in a narrow panel, so the name keeps the room the heart took. */}
        <span className="hidden @[17rem]:inline w-5 shrink-0 text-right font-mono text-[10px] text-faint tabular-nums">
          {index}
        </span>
        <ExploreThumb
          category={item.category}
          seed={item.name}
          portrait={item.portrait}
          drawing={item.drawing}
          hue={item.hue}
          size={40}
        />
        <span className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-[13px] text-strong">{item.name}</span>
            {item.builtin && (
              <span className="hidden @[17rem]:inline shrink-0 px-1 rounded-sm border border-line font-mono text-[8.5px] tracking-wider text-faint">
                BUILT-IN
              </span>
            )}
          </span>
          <span className="truncate text-[11.5px] text-muted">
            {showKind ? `${CATEGORIES[item.category].kind} · ${item.meta}` : item.meta}
          </span>
          {item.tags.length > 0 && (
            <span className="truncate font-mono text-[10px] text-faint">
              {item.tags.map((tag) => `#${tag}`).join(" ")}
            </span>
          )}
        </span>
      </button>
      {/* Not a pick: hearting something leaves you where you are. */}
      {item.favouritable && <FavouriteButton item={item} />}
      {onAdd && (
        <button
          type="button"
          title={ADD_HINT[item.source.kind]?.(item.name)}
          aria-label={ADD_HINT[item.source.kind]?.(item.name)}
          onClick={onAdd}
          className="shrink-0 w-7 h-7 rounded-md text-[18px] leading-none text-faint hover:text-strong hover:bg-you/10 cursor-pointer"
        >
          +
        </button>
      )}
      {onRemove && (
        <Menu
          label={`Actions: ${item.name}`}
          triggerClassName="shrink-0 w-7 h-7 text-[17px] leading-none text-faint hover:text-ink cursor-pointer"
          items={[{ label: onRemove.label, danger: true, onClick: onRemove.run }]}
        />
      )}
    </div>
  );
}
