import { useMemo, useSyncExternalStore } from "react";
import { readFavourites, subscribeFavourites } from "./store";

/** Your favourites, live: hearted device refs, newest first (COMM-1.9.3). */
export function useFavourites(): readonly string[] {
  return useSyncExternalStore(subscribeFavourites, readFavourites, readFavourites).refs;
}

/**
 * The same favourites as a set, for asking "is this one hearted?" per row. Built once per change:
 * the store hands out the same `refs` array until it notifies, so the memo holds across renders.
 */
export function useHearted(): ReadonlySet<string> {
  const refs = useFavourites();
  return useMemo(() => new Set(refs), [refs]);
}
