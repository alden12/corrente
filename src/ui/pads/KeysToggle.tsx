/**
 * The keyboard button that shows and hides the keys on touch (MOBILE-24). It sits at the right of
 * the keys' header, and of the minimised sheet's bar when there is no keys header to hold it, so
 * it is in the same place either way.
 *
 * Outlined, and with a chevron saying which way the keys will go (up to show, down to hide), rather
 * than lit while they show: in the sheet's bar it is a control of its own, not the sheet's.
 */
import type { Fold } from "../controls/FoldButton";
import { KeyboardIcon } from "../shellIcons";

export function KeysToggle({ fold }: { fold: Fold }) {
  return (
    <button
      type="button"
      aria-expanded={fold.open}
      aria-label={fold.open ? "Hide the keys" : "Show the keys"}
      title={fold.open ? "Hide the keys" : "Show the keys"}
      onClick={fold.onToggle}
      className="shrink-0 inline-flex items-center gap-0.5 h-9 pl-1.5 pr-1 rounded-lg border border-line text-muted hover:text-ink cursor-pointer"
    >
      <KeyboardIcon />
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5"
      >
        <path d={fold.open ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"} />
      </svg>
    </button>
  );
}
