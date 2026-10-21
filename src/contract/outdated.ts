/**
 * Whether this client is too old to keep going (HOST-23.1): the server refused its protocol version,
 * or a stored project was saved by a newer app. Either way the fix is the same, a reload onto the new
 * build, so the app shows one required update notice for both. Once set it stays set for the session.
 *
 * Client-side state, so not in the contract's barrel the server imports.
 */
let outdated = false;
const listeners = new Set<() => void>();

export function markOutdated(): void {
  if (outdated) return;
  outdated = true;
  listeners.forEach((listener) => listener());
}

export const isOutdated = (): boolean => outdated;

export function subscribeOutdated(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
