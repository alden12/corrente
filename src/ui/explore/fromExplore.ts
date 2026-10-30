/**
 * Whether Projects was reached from Explore's home (COMM-2), so its pages offer the way back. Not
 * persisted: a reload starts fresh, and moving between places any other way clears it.
 */
import { useSyncExternalStore } from "react";
import { createListeners } from "../../listeners";

let fromExplore = false;
const listeners = createListeners();

export function setFromExplore(next: boolean): void {
  if (next === fromExplore) return;
  fromExplore = next;
  listeners.emit();
}

export const useFromExplore = (): boolean => useSyncExternalStore(listeners.subscribe, () => fromExplore);
