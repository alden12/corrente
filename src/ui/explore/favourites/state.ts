/**
 * Favourites as data (COMM-1.9.3): what is hearted, newest first, plus the changes the server has not
 * yet confirmed. Pure, so the merge rules are testable without a browser or a server; `store.ts` keeps
 * it in localStorage and talks to the API.
 *
 * **Local first.** A heart shows the moment it is tapped and survives a reload with no network. Each
 * change is also queued in `pending` until a sync confirms it, so hearts made offline (or before
 * signing in, see `mergeSignedOut`) reach the account when it is next reachable. The server's
 * operations are idempotent, which keeps the queue simple: a change is resent until confirmed, and
 * resending one that already landed changes nothing.
 */
export type FavouriteChange = "add" | "remove";

export interface FavouritesState {
  /** Hearted device refs, newest first. */
  refs: readonly string[];
  /** Changes not yet confirmed by the server, by ref. Only the latest change to a ref matters. */
  pending: Readonly<Record<string, FavouriteChange>>;
}

export const EMPTY_FAVOURITES: FavouritesState = { refs: [], pending: {} };

/** Heart `ref` if it is not hearted, else un-heart it, queueing the change either way. */
export function toggleFavourite(state: FavouritesState, ref: string): FavouritesState {
  const hearted = state.refs.includes(ref);
  return {
    refs: hearted ? state.refs.filter((each) => each !== ref) : [ref, ...state.refs],
    pending: { ...state.pending, [ref]: hearted ? "remove" : "add" },
  };
}

/** The queued changes as one request body, at most `limit` of them (the rest go next time). */
export function changesToSend(state: FavouritesState, limit: number): { add: string[]; remove: string[] } {
  const entries = Object.entries(state.pending).slice(0, limit);
  const of = (change: FavouriteChange) => entries.filter(([, each]) => each === change).map(([ref]) => ref);
  return { add: of("add"), remove: of("remove") };
}

/**
 * Fold in the server's answer to a sync that sent `sent`.
 *
 * A change is settled only if it is still the one that was sent: tapping the heart again while the
 * request was in flight queues a newer change, which must survive to the next sync. The server's
 * list is then the truth, with whatever is still queued laid over it - unconfirmed hearts on top
 * (they are the newest), unconfirmed un-hearts left out.
 */
export function applyServerList(
  state: FavouritesState,
  serverRefs: readonly string[],
  sent: { add: readonly string[]; remove: readonly string[] },
): FavouritesState {
  // Sets, so each check is a lookup rather than a scan: one pass over each list, however long.
  const wasSent = { add: new Set(sent.add), remove: new Set(sent.remove) };
  const stillQueued = Object.entries(state.pending).filter(([ref, change]) => !wasSent[change].has(ref));
  const onServer = new Set(serverRefs);
  const adds = stillQueued.filter(([ref, change]) => change === "add" && !onServer.has(ref)).map(([ref]) => ref);
  const removes = new Set(stillQueued.filter(([, change]) => change === "remove").map(([ref]) => ref));
  return {
    refs: [...adds, ...serverRefs.filter((ref) => !removes.has(ref))],
    pending: Object.fromEntries(stillQueued),
  };
}

/**
 * Bring the hearts made while signed out into an account (merged on sign-in, decided 2026-10-10):
 * each becomes a queued heart on the account, so the next sync adds it there. The account's own
 * queue wins for a ref both have touched, since it is the account's later intent.
 */
export function mergeSignedOut(account: FavouritesState, signedOut: FavouritesState): FavouritesState {
  const held = new Set(account.refs);
  const incoming = signedOut.refs.filter((ref) => !held.has(ref) && !(ref in account.pending));
  return {
    refs: [...incoming, ...account.refs],
    pending: { ...Object.fromEntries(incoming.map((ref) => [ref, "add" as const])), ...account.pending },
  };
}
