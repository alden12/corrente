/**
 * A row swiped sideways to show the actions behind it (DAW-83, the tree on a phone): drag a touch
 * left and the row follows, past half the actions' width it stays open, short of that it springs
 * back. Mouse pointers never swipe; they get the actions on hover.
 *
 * One row open at a time: the tree keeps which (`openId`), so opening one closes the last. The
 * click a swipe ends with is swallowed, so letting go never also selects the row, and a tap on an
 * open row closes it rather than choosing it.
 */
import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

/** How far a touch moves before it is a swipe rather than a tap or a scroll. */
const SLOP_PX = 8;

export function useSwipeActions(
  id: string,
  openId: string | null,
  setOpenId: (id: string | null) => void,
  width: number,
) {
  const open = openId === id;
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    start.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (!swiped.current && (Math.abs(dx) < SLOP_PX || Math.abs(dx) < Math.abs(dy))) return;
    const starting = !swiped.current;
    swiped.current = true;
    setDrag(Math.min(0, Math.max(-width, (open ? -width : 0) + dx)));
    // Held from here, so the row keeps following a finger that drifts off it.
    if (starting) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerEnd = () => {
    if (swiped.current && drag !== null) setOpenId(drag < -width / 2 ? id : null);
    start.current = null;
    setDrag(null);
  };
  const onClickCapture = (event: MouseEvent) => {
    if (!swiped.current && !open) return;
    event.preventDefault();
    event.stopPropagation();
    if (!swiped.current) setOpenId(null);
    swiped.current = false;
  };

  return {
    /** How far the row sits to the left, in px. */
    offset: drag ?? (open ? -width : 0),
    dragging: drag !== null,
    open,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
    },
  };
}
