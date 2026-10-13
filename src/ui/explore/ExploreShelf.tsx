/**
 * A shelf: a titled row of item cards that scrolls sideways (board `FeedHome`). Recently used is the
 * first (COMM-1.9.7); the catalogue-wide shelves to come (COMM-1.9.4: Most favourited, Most added)
 * are the same component with other items. A card does what the item's list row does (`itemTaps`).
 *
 * A finger swipes it. A mouse wheel cannot scroll sideways, so with a fine pointer the title row
 * carries previous / next arrows that page it, shown only when there is more to see that way.
 */
import { useEffect, useRef, useState } from "react";
import type { ExploreItem } from "./exploreItems";
import type { ItemTaps } from "./itemTaps";
import { ExploreThumb } from "./ExploreThumb";

const CARD = 92;

/** How far a shelf's edge fades out when there are more cards beyond it. */
const FADE = 28;

/** A mask that fades whichever edges have more beyond them, rather than cutting a card off hard. */
const edgeFade = ({ back, on }: { back: boolean; on: boolean }): string =>
  `linear-gradient(to right, ${back ? "transparent" : "black"} 0, black ${back ? FADE : 0}px, ` +
  `black calc(100% - ${on ? FADE : 0}px), ${on ? "transparent" : "black"} 100%)`;

/** Whether the row can scroll further back and further on, kept current as it scrolls or resizes. */
function useScrollEnds(row: React.RefObject<HTMLUListElement | null>, count: number) {
  const [ends, setEnds] = useState({ back: false, on: false });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () =>
      setEnds({
        back: element.scrollLeft > 1,
        on: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      });
    // The observer reports the row's size as soon as it starts watching, which is the first measure.
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      resize.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [row, count]);
  return ends;
}

function PageArrow({
  label,
  flip,
  shown,
  onClick,
}: {
  label: string;
  flip?: boolean;
  shown: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={!shown}
      className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-control cursor-pointer disabled:opacity-0 disabled:pointer-events-none transition-opacity"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        className={`w-4 h-4 ${flip ? "rotate-180" : ""}`}
      >
        <path d="M6 3l5 5-5 5" />
      </svg>
    </button>
  );
}

export function ExploreShelf({
  title,
  items,
  taps,
  trying,
}: {
  title: string;
  items: ExploreItem[];
  taps: ItemTaps;
  /** The key of the item in the try panel, so its card shows it. */
  trying: string | undefined;
}) {
  const row = useRef<HTMLUListElement>(null);
  const ends = useScrollEnds(row, items.length);
  /** Page by most of what is in view, so the last card seen stays as a landmark. */
  const page = (direction: 1 | -1) => {
    const element = row.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: "smooth" });
  };
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-0.5 pt-2">
      <div className="flex items-center gap-1 pl-3.5 pr-2 min-h-7">
        <h3 className="flex-1 font-mono text-[10px] uppercase tracking-wider text-faint">{title}</h3>
        {(ends.back || ends.on) && (
          <span className="hidden pointer-fine:flex">
            <PageArrow label={`Back through ${title}`} flip shown={ends.back} onClick={() => page(-1)} />
            <PageArrow label={`More ${title}`} shown={ends.on} onClick={() => page(1)} />
          </span>
        )}
      </div>
      {/* A sideways scroller clips on every side, so it leaves room for a card's ring top and bottom. */}
      <ul
        ref={row}
        className="flex gap-2.5 overflow-x-auto px-3.5 py-1 scrollbar-none"
        style={{ maskImage: edgeFade(ends), WebkitMaskImage: edgeFade(ends) }}
      >
        {items.map((item) => (
          <li key={item.key} className="shrink-0" style={{ width: CARD }}>
            <button
              type="button"
              // Let go of focus once tapped, as the row does: the keys are about to play the sound,
              // and a focused card would show a focus ring and take Space and Enter as another tap.
              onClick={(event) => {
                event.currentTarget.blur();
                taps.tap(item);
              }}
              aria-label={item.name}
              aria-current={item.key === trying ? "true" : undefined}
              className="group w-full flex flex-col gap-1 text-left cursor-pointer"
            >
              <span
                className={`rounded-md ${item.key === trying ? "ring-2 ring-you" : "group-hover:ring-1 group-hover:ring-line"}`}
              >
                <ExploreThumb category={item.category} seed={item.name} portrait={item.portrait} size={CARD} />
              </span>
              <span className="truncate text-[12px] text-strong">{item.name}</span>
              <span className="-mt-1 truncate text-[10.5px] text-muted">{item.meta}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
