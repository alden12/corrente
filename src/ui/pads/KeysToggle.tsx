/**
 * The keyboard button that shows and hides the keys on touch (MOBILE-24). It sits at the right of
 * the keys' header, and of the minimised sheet's bar when there is no keys header to hold it, so
 * it is in the same place either way.
 */
import type { Fold } from "../controls/FoldButton";
import { IconButton } from "../controls/IconButton";
import { KeyboardIcon } from "../shellIcons";

export function KeysToggle({ fold }: { fold: Fold }) {
  return (
    <IconButton
      label={fold.open ? "Hide the keys" : "Show the keys"}
      size="lg"
      active={fold.open}
      onClick={fold.onToggle}
      className="shrink-0"
    >
      <KeyboardIcon />
    </IconButton>
  );
}
