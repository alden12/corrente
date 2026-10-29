/**
 * The keyboard belongs to the host (PLUGIN-3.5). A host plays notes from the computer's keyboard
 * (Ableton's computer MIDI keyboard), and while this window has it, each key reaches the host late or
 * not at all: notes hold too long, and quick presses are lost. So after every click, and when a text
 * field lets go, the plugin hands it back (`keys`), unless the focus is somewhere you type, like
 * Explore's search, or the window's own keys have taken the keyboard (`keyboardTaken`, PLUGIN-3.11).
 */
import type { ToPlugin } from "./pluginDevice";
import { keyboardTaken } from "./pluginKeys";

/** The input types that take typing; a range, checkbox or button doesn't. */
const TYPED = new Set(["text", "search", "number", "email", "url", "tel", "password"]);

const typingIn = (element: Element | null): boolean =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement && TYPED.has(element.type)) ||
  (element instanceof HTMLElement && element.isContentEditable);

/** Hand the keyboard back now, and after each click or text field let go, unless typing or taken. */
export function keysToHost(send: (message: ToPlugin) => void): void {
  // After the event, so focus has moved to where the click put it.
  const giveBack = () =>
    setTimeout(() => {
      if (!keyboardTaken.read() && !typingIn(document.activeElement)) send({ type: "keys" });
    }, 0);
  document.addEventListener("pointerup", giveBack);
  document.addEventListener("focusout", giveBack);
  // Let go of the keyboard as soon as the keys give it up, not on the next click.
  keyboardTaken.subscribe(giveBack);
  giveBack();
}
