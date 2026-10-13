/**
 * The pieces the panels pinned under Explore share (the try panel, COMM-1.4.1, and the effect
 * panel): the header that names the item, and the actions' icons.
 */
import type { ReactNode } from "react";
import type { ExploreItem } from "./exploreItems";
import { ExploreThumb } from "./ExploreThumb";
import { FavouriteButton } from "./favourites/FavouriteButton";

/**
 * The item's artwork and name, anything that says what mode it is in, its favourite heart (so it
 * can be hearted while trying it), and a close button.
 */
export function PanelHeader({
  item,
  name,
  closeLabel,
  onClose,
  children,
}: {
  /** The row it came from, for its artwork, so the panel reads as that row. */
  item: ExploreItem | undefined;
  name: string;
  closeLabel: string;
  onClose: () => void;
  /** A chip after the name, if there is a mode to show. */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {item && <ExploreThumb category={item.category} seed={item.name} portrait={item.portrait} size={40} />}
      {/* The name wraps rather than truncates in a narrow column; a chip follows it, on its line or the
          next, with room either way. */}
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="min-w-0 text-[16px] leading-snug font-semibold text-strong break-words">{name}</span>
        {children}
      </div>
      {item?.favouritable && (
        <FavouriteButton item={item} className="w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11" />
      )}
      <button
        type="button"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onClose}
        className="shrink-0 w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-control cursor-pointer"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="w-4 h-4"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export function SwapIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-4 h-4 shrink-0"
    >
      <path d="M3 6.5A5 5 0 0 1 12.2 4.3M13 9.5a5 5 0 0 1-9.2 2.2" />
      <path d="M12.6 1.8v2.8H9.8M3.4 14.2v-2.8h2.8" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="w-4 h-4 shrink-0"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
