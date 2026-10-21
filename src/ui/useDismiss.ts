/**
 * Close an open popover on a press outside it (and outside its trigger) or on Escape, as the app's
 * menus do. A press inside any menu or popover (`insideMenu`) doesn't count as outside.
 */
import { useEffect, type RefObject } from "react";
import { insideMenu } from "./insideMenu";

export function useDismiss(open: boolean, close: () => void, triggerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!insideMenu(event.target) && !triggerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, triggerRef]);
}
