/**
 * A strip of chips that scrolls sideways inside a section header (DAW-61.1): the clips, the devices.
 * Its edges fade where there is more to scroll to, and with a precise pointer, arrows either side
 * page it, since a mouse wheel alone doesn't scroll sideways.
 */
import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { edgeFade, pageRow, useScrollEnds } from "../scrollFade";
import { PageArrow } from "./PageArrow";

export function PagedStrip({
  label,
  count,
  className = "",
  scrollerProps,
  children,
}: {
  /** What the arrows page through, for their labels ("clips": "Back through clips"). */
  label: string;
  /** How many items it holds, so the ends are measured again as it changes. */
  count: number;
  /** The scroller's own classes: its gap, its padding. */
  className?: string;
  /** Anything else the scroller takes (a key handler, a data attribute). */
  scrollerProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const ends = useScrollEnds(row, count);
  const arrows = ends.back || ends.on;
  // Only as wide as its chips (plus a little room), so the header's empty space past them still
  // folds the section: a strip of one or two chips no longer takes the whole header.
  return (
    // Swiped, so its gaps (and a 16px margin past the last chip) are not the header's to fold on.
    <div data-no-fold className="min-w-0 flex items-center pr-4">
      {arrows && (
        <span className="hidden pointer-fine:flex shrink-0">
          <PageArrow label={`Back through ${label}`} flip shown={ends.back} onClick={() => pageRow(row, -1)} />
        </span>
      )}
      <div
        {...scrollerProps}
        ref={row}
        className={`min-w-0 flex items-center overflow-x-auto scrollbar-none ${className}`}
        style={{ maskImage: edgeFade(ends), WebkitMaskImage: edgeFade(ends) }}
      >
        {children}
      </div>
      {arrows && (
        <span className="hidden pointer-fine:flex shrink-0">
          <PageArrow label={`More ${label}`} shown={ends.on} onClick={() => pageRow(row, 1)} />
        </span>
      )}
    </div>
  );
}
