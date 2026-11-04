/**
 * The key change (DAW-12.3): while a chord that leads to a new key is held (a secondary dominant), a
 * bubble above it offers the change - "→ G major" - and takes it in one edit to the song's key, so it's
 * undoable and the MIDI devices that follow the key move too. After it, the chord held is in the key,
 * and its resolution lights as the new home.
 *
 * **Above the chord, not in the header** (2026-11-04, Alden: the header's button was cut off on a
 * phone): slide the finger up onto it and let go there, or click it with the computer key held. A
 * finger's pointer is captured by its pad, so the bubble never hears that lift itself: it's a lift
 * target (`LIFT_TARGET`), which the pad's touch handling clicks for it. Portaled and fixed, so a
 * scrolling row of chords can't clip it.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CONTROL_BASE } from "../controls/tone";
import { LIFT_TARGET } from "./usePadTouch";

/** The gap between the bubble and the chord it sits over, and how close it may come to the screen's edge. */
const GAP_PX = 6;
const EDGE_PX = 4;
const HEIGHT_PX = 28;

export function KeyChangeBubble({
  anchor,
  label,
  onTake,
}: {
  /** The pad or key held. */
  anchor: RefObject<HTMLElement | null>;
  /** The key it leads to, as the menu writes it: "G major". */
  label: string;
  onTake: () => void;
}) {
  const bubble = useRef<HTMLButtonElement>(null);
  // Placed on the page by hand, after the layout: where the chord is on screen is only known then.
  useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box || !bubble.current) return;
    bubble.current.style.left = `clamp(${EDGE_PX}px + 4em, ${box.left + box.width / 2}px, 100vw - ${EDGE_PX}px - 4em)`;
    bubble.current.style.top = `${Math.max(EDGE_PX, box.top - GAP_PX - HEIGHT_PX)}px`;
  }, [anchor]);
  return createPortal(
    <button
      ref={bubble}
      type="button"
      {...{ [LIFT_TARGET]: "" }}
      onClick={onTake}
      aria-label={`Change key to ${label}`}
      className={`${CONTROL_BASE} fixed z-50 -translate-x-1/2 px-3 rounded-full shadow-md bg-card ring-1 ring-line text-ink font-mono text-[12px] whitespace-nowrap hover:bg-line data-[over]:bg-line data-[over]:ring-muted`}
      style={{ height: HEIGHT_PX }}
    >
      {`→ ${label}`}
    </button>,
    document.body,
  );
}
