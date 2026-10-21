/**
 * A right-click menu (DAW-74): the same menu the ⋮ buttons open, opened at the pointer instead. On a
 * phone an object's actions are on its ⋮ (MOBILE-7), shown on touch only; a mouse gets them here, from
 * the same `MenuItem` list, so the two never drift apart.
 *
 * `useContextMenu` opens it. It hangs from a point fixed where the click was, and closes on a click
 * elsewhere, Escape or a choice.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MenuList, Popover, type MenuItem } from "./Menu";
import { insideMenu } from "./insideMenu";

/** The rows, or a getter read while it's open (see `Menu`). */
export type ContextMenuItems = MenuItem[] | (() => MenuItem[]);

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItems;
  onClose: () => void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!insideMenu(event.target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const rows = typeof items === "function" ? items() : items;
  return (
    <>
      {/* The point it hangs from: in the body, so no transformed ancestor moves what "fixed" means. */}
      {createPortal(
        <span ref={anchorRef} aria-hidden="true" style={{ position: "fixed", left: x, top: y }} />,
        document.body,
      )}
      <Popover anchorRef={anchorRef} strategy="below" side="right" onDetached={onClose}>
        {() => <MenuList items={rows} side="left" onDismiss={onClose} />}
      </Popover>
    </>
  );
}
