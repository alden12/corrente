// Non-text inputs (checkbox / radio / range / button / select ...) don't consume typed text, so
// keyboard shortcuts and computer-keyboard playing should keep working while one is
// focused. Only genuine text entry (text inputs, textareas, contentEditable) should swallow
// keys. Fixes toggles blocking keyboard play after you click them, and a select (the Sampler's
// sample) taking the keys you play as a search, changing the sample, until clicked away from:
// the players claim the keys they use, so arrows still move through a select's options.
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName === "INPUT") return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  return false;
}
