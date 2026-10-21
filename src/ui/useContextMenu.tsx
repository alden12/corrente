import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { ContextMenu, type ContextMenuItems } from "./ContextMenu";

/** A right-click menu (`ContextMenu`): an opener for `onContextMenu`, and the element to render. */
export function useContextMenu(): {
  /** For `onContextMenu`: opens these items where the click was, instead of the browser's menu. */
  openAt: (event: MouseEvent, items: ContextMenuItems) => void;
  menu: ReactNode;
} {
  const [open, setOpen] = useState<{ x: number; y: number; items: ContextMenuItems } | null>(null);
  const openAt = (event: MouseEvent, items: ContextMenuItems) => {
    // A long press fires this on Android: touch keeps its ⋮ (MOBILE-7), and its own gestures.
    if ((event.nativeEvent as PointerEvent).pointerType === "touch") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen({ x: event.clientX, y: event.clientY, items });
  };
  const close = useCallback(() => setOpen(null), []);
  return { openAt, menu: open && <ContextMenu {...open} onClose={close} /> };
}
