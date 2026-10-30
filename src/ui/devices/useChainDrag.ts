/**
 * Reordering a chain's devices (an effect chain, the MIDI devices) by dragging a device's handle.
 * Pointer events rather than the browser's drag and drop, which a phone doesn't do: the handle
 * captures the pointer, and where it is says where the device would land, read off the other
 * devices' boxes on screen. The handle's arrow keys move it one place, for a keyboard.
 *
 * Where it lands: the device nearest the pointer, then before or after it by which side of its
 * middle the pointer is, across a row on the desktop (devices wrap like text) or down the column
 * when the rack is stacked.
 */
import { useContext, useState, type KeyboardEvent, type PointerEvent } from "react";
import { RackStacked } from "./rackLayout";

export interface DeviceDrag {
  /** What the handle needs: it starts a drag, and its arrow keys move the device. */
  handle: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  /** This device is the one being dragged. */
  dragging: boolean;
  /** The dragged device would land on this side of this one. */
  drop?: "before" | "after";
}

/** A device's box on screen, by its `data-device` key (the chain's ids). */
const boxOf = (id: string) => document.querySelector(`[data-device="${CSS.escape(id)}"]`)?.getBoundingClientRect();

/** How far a point is from a box, 0 inside it. */
const distance = (box: DOMRect, x: number, y: number) =>
  Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));

/** Each device's drag, by id; `move` puts one at an index in the chain. */
export function useChainDrag(
  ids: readonly string[],
  move: (id: string, toIndex: number) => void,
): (id: string) => DeviceDrag {
  const stacked = useContext(RackStacked);
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);

  /** Where `id` would land with the pointer at (x, y): its index once it's out of the way. */
  const landing = (id: string, x: number, y: number): number => {
    const others = ids
      .filter((other) => other !== id)
      .flatMap((other) => {
        const box = boxOf(other);
        return box ? [box] : [];
      });
    if (others.length === 0) return 0;
    const nearest = others.reduce(
      (best, box, index) => (distance(box, x, y) < distance(others[best], x, y) ? index : best),
      0,
    );
    const box = others[nearest];
    const past = stacked ? y > box.top + box.height / 2 : x > box.left + box.width / 2;
    return nearest + (past ? 1 : 0);
  };

  const start = (id: string) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const from = ids.indexOf(id);
    setDrag({ id, to: from });
    const follow = (moved: globalThis.PointerEvent) => setDrag({ id, to: landing(id, moved.clientX, moved.clientY) });
    const end = (ended: globalThis.PointerEvent) => {
      handle.removeEventListener("pointermove", follow);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDrag(null);
      if (ended.type !== "pointerup") return;
      const to = landing(id, ended.clientX, ended.clientY);
      if (to !== from) move(id, to);
    };
    handle.addEventListener("pointermove", follow);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const KEYS: Record<string, number> = stacked ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 };
  const step = (id: string) => (event: KeyboardEvent<HTMLElement>) => {
    const by = KEYS[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const to = ids.indexOf(id) + by;
    if (to >= 0 && to < ids.length) move(id, to);
  };

  // The mark goes on the device the dragged one would land before, or after the last; none while it
  // would land where it is.
  const others = drag ? ids.filter((other) => other !== drag.id) : [];
  const moving = drag !== null && drag.to !== ids.indexOf(drag.id);
  const dropOn = (id: string): DeviceDrag["drop"] => {
    if (!moving || !drag) return undefined;
    if (others[drag.to] === id) return "before";
    return drag.to === others.length && others.at(-1) === id ? "after" : undefined;
  };

  return (id) => ({
    handle: { onPointerDown: start(id), onKeyDown: step(id) },
    dragging: drag?.id === id,
    ...(dropOn(id) ? { drop: dropOn(id) } : {}),
  });
}
