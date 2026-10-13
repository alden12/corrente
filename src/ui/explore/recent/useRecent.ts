import { useSyncExternalStore } from "react";
import { readRecent, subscribeRecent } from "./store";

/** What you took from Explore lately, newest first (COMM-1.9.7). */
export function useRecent(): readonly string[] {
  return useSyncExternalStore(subscribeRecent, readRecent, readRecent);
}
