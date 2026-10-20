/**
 * The favourites store (COMM-1.9.3): `state.ts`'s data, kept per account in localStorage (through
 * `persistentStore`) and synced with the API when there is one. Mirrors the patch library's shape -
 * plain functions plus a subscribe seam, no React - and `useFavourites` bridges it to the UI.
 *
 * **One bucket per account.** Favourites are stored under the signed-in user's id, or `local` with no
 * account (no-API builds, auth off, or signed out), so two people sharing a browser never see each
 * other's hearts. Signing in folds the `local` bucket into the account (`mergeSignedOut`).
 *
 * **When it syncs:** on start, on signing in, when the browser comes back online, and after every
 * tap. A failed sync leaves the queue for the next one; the hearts on screen never wait for it.
 */
import { createApiClient, type ApiClient } from "../../../contract/client";
import { MAX_FAVOURITE_CHANGES } from "../../../contract/http";
import {
  accountOwner as owner,
  authEnabled,
  getAccessToken,
  onUnauthorized,
  SIGNED_OUT,
  subscribeAuth,
} from "../../../auth/session";
import { readPersistent, writePersistent } from "../../persistentStore";
import {
  applyServerList,
  changesToSend,
  EMPTY_FAVOURITES,
  mergeSignedOut,
  toggleFavourite as toggled,
  type FavouritesState,
} from "./state";

const apiUrl = import.meta.env?.VITE_DAW_API_URL;
const client: ApiClient | null = apiUrl
  ? createApiClient({ baseUrl: apiUrl, token: getAccessToken, onUnauthorized })
  : null;

const storageKey = (owner: string) => `corrente:favourites:v1:${owner}`;

/** Whether there is an account to sync with: an API, and (when auth is on) someone signed in to it. */
const canSync = () => client !== null && (!authEnabled || owner() !== SIGNED_OUT);

/**
 * One account's favourites. Storage goes through `persistentStore`, which already copes with
 * localStorage being unavailable (favourites then last the session); what is left here is parsing,
 * since a stored value may be from an older shape or hand-edited.
 */
function read(key: string): FavouritesState {
  try {
    const parsed = JSON.parse(readPersistent(storageKey(key)) ?? "null") as FavouritesState | null;
    return parsed && Array.isArray(parsed.refs) && typeof parsed.pending === "object" ? parsed : EMPTY_FAVOURITES;
  } catch {
    return EMPTY_FAVOURITES;
  }
}

const listeners = new Set<() => void>();
let currentOwner = owner();
let state = read(currentOwner);

function write(next: FavouritesState): void {
  state = next;
  writePersistent(storageKey(currentOwner), JSON.stringify(next));
  for (const listener of listeners) listener();
}

/** The current favourites (a stable snapshot between notifications, for `useSyncExternalStore`). */
export const readFavourites = (): FavouritesState => state;

export function subscribeFavourites(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Heart or un-heart a device, at once, then tell the server. */
export function toggleFavourite(ref: string): void {
  write(toggled(state, ref));
  void syncFavourites();
}

let inFlight: Promise<void> | null = null;
let rerun = false;

/**
 * Send what is queued and take the server's list back. One at a time: a call while a sync is running
 * asks it to go round again rather than racing it, so the last tap is always sent.
 */
export function syncFavourites(): Promise<void> {
  if (!canSync()) return Promise.resolve();
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  inFlight = (async () => {
    let more = true;
    while (more) {
      rerun = false;
      const syncedFor = currentOwner;
      const sent = changesToSend(state, MAX_FAVOURITE_CHANGES);
      try {
        const list = await client!.syncFavourites(sent);
        // Signed out or switched account mid-request: this answer is someone else's now.
        if (syncedFor !== currentOwner) return;
        write(
          applyServerList(
            state,
            list.map((favourite) => favourite.ref),
            sent,
          ),
        );
      } catch (error) {
        console.warn("[favourites] sync failed; changes stay queued", error);
        return;
      }
      const full = sent.add.length + sent.remove.length === MAX_FAVOURITE_CHANGES;
      more = rerun || (full && Object.keys(state.pending).length > 0);
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Follow the signed-in account: load its bucket, fold in anything hearted signed out, and sync. */
function followAccount(): void {
  const next = owner();
  if (next === currentOwner) return;
  currentOwner = next;
  const account = read(next);
  const signedOut = next === SIGNED_OUT ? EMPTY_FAVOURITES : read(SIGNED_OUT);
  if (signedOut.refs.length > 0) {
    writePersistent(storageKey(SIGNED_OUT), JSON.stringify(EMPTY_FAVOURITES));
    write(mergeSignedOut(account, signedOut));
  } else {
    state = account;
    for (const listener of listeners) listener();
  }
  void syncFavourites();
}

subscribeAuth(followAccount);
if (typeof window !== "undefined") window.addEventListener("online", () => void syncFavourites());
void syncFavourites();
