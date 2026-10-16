/**
 * Folding a section from a tap anywhere on its header (DAW-61.1, MOBILE-24): the column's sections
 * and the device blocks.
 */
import type { MouseEvent } from "react";

/**
 * What a tap on a header may not take over: anything that is a control of its own, anything
 * marked `data-no-fold` (a strip of chips you swipe, whose gaps are part of it), and a menu or
 * dialog opened from the header, which is portaled elsewhere but still bubbles through it.
 */
const OWN_CONTROLS = [
  "button, a, input, select, textarea, [draggable=true], [data-no-fold]",
  "[role=button], [role=slider], [role=menu], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=dialog]",
].join(", ");

/**
 * A header's click handler that folds its section, unless the tap was on one of the header's own
 * controls: the whole header is the target, as it is to a thumb, and the arrow is its keyboard route.
 */
export const foldOnHeaderClick = (onToggle: () => void) => (event: MouseEvent) => {
  if (event.target instanceof Element && event.target.closest(OWN_CONTROLS)) return;
  if (onDisabledControl(event)) return;
  onToggle();
};

/**
 * Whether the tap landed on a disabled control. Those take no pointer events (`CONTROL_BASE`), so the
 * header is the tap's target, and only where it landed says it was meant for the control - an octave
 * arrow at the end of its range, say, which folded the keys away.
 */
const onDisabledControl = ({ currentTarget, clientX, clientY }: MouseEvent): boolean =>
  [...currentTarget.querySelectorAll(":disabled")].some((control) => {
    const box = control.getBoundingClientRect();
    return clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
  });
