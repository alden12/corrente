/**
 * Whether this is a Mac (or an iPad with a keyboard), where Cmd is the shortcut key and Ctrl is
 * left free: what lets Ctrl+Shift lift the chord keys there (keyLayout's `lift`) without clashing.
 */
export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
