/**
 * The library follows the account (COMM-1.11.2), the way favourites do. Each account has its own
 * library on the device, and signed out has another, so two people sharing a browser never see each
 * other's patches. Signed in, the account's library syncs with the server, and what was saved signed
 * out moves into it: sent to the account, then cleared from the signed-out library.
 *
 * **When it syncs:** on start, on signing in, after every save, when the browser comes back online,
 * and when the tab is looked at again (changes made on other devices arrive then). A failed sync
 * leaves the queue for the next one; nothing on screen waits for it.
 */
import {
  accountOwner,
  authEnabled,
  getAccessToken,
  onUnauthorized,
  SIGNED_OUT,
  subscribeAuth,
} from "../../auth/session";
import { createApiClient } from "../../contract/client";
import { openLibrary } from "../patches/library";
import type { LibraryBackend, LibraryOutbox } from "./backend";
import { indexedDbBackend } from "./indexedDb";
import { drainLibrary, type SendLibrary } from "./sync";

type Library = LibraryBackend & LibraryOutbox;

const apiUrl = import.meta.env?.VITE_DAW_API_URL;
const client = apiUrl ? createApiClient({ baseUrl: apiUrl, token: getAccessToken, onUnauthorized }) : null;
const send: SendLibrary = (request) => client!.syncLibrary(request);

/** The database an account's library lives in. */
export const libraryDatabase = (owner: string) =>
  owner === SIGNED_OUT ? "corrente-library" : `corrente-library:${owner}`;

/** Whether `owner` has an account to sync with: an API, and (when auth is on) someone signed in to it. */
const canSync = (owner: string) => client !== null && (!authEnabled || owner !== SIGNED_OUT);

/** The library in use, and whose it is. */
let open: { owner: string; library: Library } | undefined;
/** Signed out's library, while someone is signed in: what's left in it to move into their account. */
let signedOut: Library | undefined;

/** A library whose every save asks for a sync, so it reaches the account soon after. */
const syncingOnSave = (library: Library): Library => ({
  ...library,
  save: async (item, version) => {
    await library.save(item, version);
    void syncLibrary();
  },
});

let inFlight: Promise<void> | null = null;
let again = false;

/** One sync: anything saved signed out into the account, then the account's queue out and its changes back. */
async function syncOnce(): Promise<void> {
  const current = open;
  if (!current || !canSync(current.owner)) return;
  // The library still open, and its owner still the one signed in (the token `send` uses).
  const stillCurrent = () => open === current && accountOwner() === current.owner;
  try {
    if (signedOut && current.owner !== SIGNED_OUT) {
      await drainLibrary(signedOut, current.library, send, stillCurrent);
      // Only once every save has gone: refused ones, and any past the drain's rounds, stay where they were.
      if (stillCurrent() && (await signedOut.isEmpty())) {
        await signedOut.clear();
        signedOut = undefined;
      }
    }
    await drainLibrary(current.library, current.library, send, stillCurrent);
  } catch (error) {
    console.warn("[corrente] the library didn't sync; saves stay queued", error);
  }
}

/**
 * Run `sync` holding this account's library lock, so two tabs never send one queue twice (the
 * account would keep the resent save as a newer version). Where Web Locks are missing, as is.
 */
const holdingLock = (owner: string, sync: () => Promise<void>): Promise<void> =>
  typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(`${libraryDatabase(owner)}:sync`, sync)
    : sync();

/**
 * Sync the library with the account. One at a time: asked while one runs, it starts another once
 * that one is done, so a save made mid-sync is sent.
 */
export function syncLibrary(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  again = false;
  inFlight = (open ? holdingLock(open.owner, syncOnce) : syncOnce()).finally(() => {
    inFlight = null;
    if (again) void syncLibrary();
  });
  return inFlight;
}

let following: Promise<void> = Promise.resolve();

/** Open the signed-in account's library (signed out's, with nobody signed in), then sync it. */
function followAccount(): void {
  following = following
    .then(async () => {
      const owner = accountOwner();
      if (open?.owner === owner) return;
      const library = await indexedDbBackend(libraryDatabase(owner));
      // No IndexedDB: the library stays in memory for the session.
      if (!library) return;
      signedOut = owner === SIGNED_OUT ? undefined : await indexedDbBackend(libraryDatabase(SIGNED_OUT));
      open = { owner, library: syncingOnSave(library) };
      await openLibrary(open.library);
      void syncLibrary();
    })
    .catch((error: unknown) => console.warn("[corrente] the library didn't open:", error));
}

/** Open the library and keep it following the account: called once, at start. */
export function startLibrary(): void {
  followAccount();
  subscribeAuth(followAccount);
  window.addEventListener("online", () => void syncLibrary());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncLibrary();
  });
}
