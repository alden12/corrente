/**
 * Recently used (COMM-1.9.7): the last few things you took from Explore, newest first, for the
 * shelf on its home page. Taking means it reached the project: picked onto a track, added as a new
 * track, swapped on or recorded with from the try panel. Only trying something does not count.
 *
 * **Local, per account,** in the same buckets as favourites (the signed-in user's id, or `local`),
 * so two people sharing a browser see their own. Nothing is sent anywhere yet: once COMM-1.9.4 needs
 * "added" events for its catalogue-wide shelves, each take becomes one, and this list can be read
 * from them instead.
 */
import { createListeners } from "../../../listeners";
import { accountOwner as owner, subscribeAuth } from "../../../auth/session";
import { readPersistent, writePersistent } from "../../persistentStore";

/** How many the shelf keeps: a row's worth, and then some for scrolling. */
export const RECENT_LIMIT = 12;

/** The list after using `key`: it moves to the front, once, and the oldest falls off the end. */
export const withUsed = (list: readonly string[], key: string, limit = RECENT_LIMIT): string[] =>
  [key, ...list.filter((each) => each !== key)].slice(0, limit);

const storageKey = (owner: string) => `corrente:recent:v1:${owner}`;

function read(account: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readPersistent(storageKey(account)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((each): each is string => typeof each === "string") : [];
  } catch {
    return [];
  }
}

const listeners = createListeners();
let currentOwner = owner();
let recent: readonly string[] = read(currentOwner);

/** The current list (a stable snapshot between notifications, for `useSyncExternalStore`). */
export const readRecent = (): readonly string[] => recent;

export const subscribeRecent = listeners.subscribe;

/** Something from Explore was taken into the project. */
export function noteUsed(key: string): void {
  recent = withUsed(recent, key);
  writePersistent(storageKey(currentOwner), JSON.stringify(recent));
  listeners.emit();
}

subscribeAuth(() => {
  const next = owner();
  if (next === currentOwner) return;
  currentOwner = next;
  recent = read(next);
  listeners.emit();
});
