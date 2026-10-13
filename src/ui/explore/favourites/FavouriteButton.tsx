/**
 * The heart that favourites an Explore item (COMM-1.9.3), on its row and on the panel it opens,
 * so it can be hearted while it is being tried as well as from the list.
 */
import type { ExploreItem } from "../exploreItems";
import { toggleFavourite } from "./store";
import { useHearted } from "./useFavourites";

/** The heart, outlined until it is on. The same shape as the Favourites tile's glyph. */
function Heart({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill={on ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      className="w-4.5 h-4.5"
    >
      <path d="M8 13.2s-5-3.1-6.1-6A3.1 3.1 0 0 1 8 4.4a3.1 3.1 0 0 1 6.1 2.8C13 10.1 8 13.2 8 13.2z" />
    </svg>
  );
}

export function FavouriteButton({
  item,
  className = "w-7 h-7",
}: {
  item: ExploreItem;
  /** Its size, which follows the controls beside it. */
  className?: string;
}) {
  const on = useHearted().has(item.key);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove "${item.name}" from favourites` : `Add "${item.name}" to favourites`}
      title={on ? "Remove from favourites" : "Add to favourites"}
      onClick={() => toggleFavourite(item.key)}
      className={`shrink-0 grid place-items-center rounded-md cursor-pointer hover:bg-you/10 ${className} ${
        on ? "text-you" : "text-faint hover:text-strong"
      }`}
    >
      <Heart on={on} />
    </button>
  );
}
