/**
 * A scroll rail drawn over a column-reverse scroller: the chord rows on the phone's pads and in the
 * desktop keys panel, which both open at the bottom (the triads) and scroll up to the rest. Drawn
 * rather than native because a phone hides its scrollbar and a Mac only shows one mid-scroll, and
 * the chords past the first rows are easy to miss without one.
 *
 * On touch the rail only shows where you are: the strip under it is a native scroll, which a thumb
 * drags. With a mouse, `draggable`, the rail is the handle: press anywhere on it to jump there, and
 * drag to scroll.
 */
import type { PointerEvent } from "react";
import type { Thumb } from "./useScrollThumb";

export function ScrollRail({
  scroller,
  thumb,
  width,
  right,
  draggable = false,
}: {
  scroller: HTMLDivElement;
  thumb: Thumb;
  width: number;
  /** How far in from the right edge of the box it is drawn over. */
  right: number;
  /** A mouse's handle, not just a marker (see above). */
  draggable?: boolean;
}) {
  // The thumb's centre goes where the pointer is, the inverse of `useScrollThumb`'s maths.
  const scrollTo = (event: PointerEvent<HTMLDivElement>) => {
    const rail = event.currentTarget.getBoundingClientRect();
    const top = Math.min(Math.max((event.clientY - rail.top) / rail.height - thumb.size / 2, 0), 1 - thumb.size);
    const range = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTo({ top: (top / (1 - thumb.size)) * range - range });
  };
  return (
    <div
      aria-hidden
      data-scroll-rail
      className={`absolute top-0 bottom-0 rounded-full bg-control ${draggable ? "cursor-pointer" : "pointer-events-none"}`}
      style={{ width, right }}
      onPointerDown={
        draggable
          ? (event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              scrollTo(event);
            }
          : undefined
      }
      onPointerMove={draggable ? (event) => event.buttons && scrollTo(event) : undefined}
    >
      <div
        className="absolute left-0 right-0 rounded-full bg-muted"
        style={{ top: `${thumb.top * 100}%`, height: `${thumb.size * 100}%` }}
      />
    </div>
  );
}
