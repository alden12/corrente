/**
 * Syncing the library with an account (COMM-1.11.2): send the queued saves, oldest first, in batches,
 * and store what the account sends back. The account numbers versions, so a save this device called
 * version 3 may come back as 4 (another device had saved a 3); what comes back is what's kept.
 *
 * The same loop merges a signed-out library into an account on sign-in: its queue (every save made
 * signed out) is sent, and what comes back is stored in the account's library instead.
 *
 * A save the account refuses (a device that won't compile, an id it holds as another kind) would
 * otherwise block everything behind it, so a refused batch is retried one save at a time, and the
 * one refused stays on this device, unsent.
 */
import { MAX_LIBRARY_SAVES } from "../../contract/http";
import type { LibraryEntry, LibraryOutbox } from "./backend";
import { librarySaveOf, type LibrarySave } from "./schema";
import { libraryMark, libraryWritten, receiveEntries } from "./store";

/** One request to the account: the saves, and where to read changes from. */
export interface LibrarySyncRequest {
  since?: string;
  saves: LibrarySave[];
}

/** The account's answer: what changed since the cursor, and the next cursor; or why it refused the saves. */
export type LibrarySyncAnswer = { cursor: string; entries: LibraryEntry[] } | { refused: string };

export type SendLibrary = (request: LibrarySyncRequest) => Promise<LibrarySyncAnswer>;

/**
 * The most requests one drain makes. Each round sends a full batch or sets aside one refused save,
 * so a drain always gets somewhere; what's left past this waits for the next sync.
 */
const MAX_ROUNDS = 20;

/**
 * Send `from`'s queue to the account and store what comes back in `into`: the same library for a
 * sync, the account's for a sign-in merge. `stillCurrent` says whether the account is still the one
 * signed in; an answer that arrives after it isn't is left alone. Returns how many saves the account
 * refused, which stay queued on `from`.
 */
export async function drainLibrary(
  from: LibraryOutbox,
  into: LibraryOutbox,
  send: SendLibrary,
  stillCurrent: () => boolean,
): Promise<number> {
  let size = MAX_LIBRARY_SAVES;
  let refused = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    await libraryWritten();
    const mark = libraryMark();
    const batch = await from.queued(size);
    // A merge with nothing left to send is done; a sync still reads what changed.
    if (!batch.length && from !== into) return refused;
    const since = await into.cursor();
    // Signed out or switched meanwhile: this queue isn't the signed-in account's to send.
    if (!stillCurrent()) return refused;
    const answer = await send({ since, saves: batch.map(({ item, version }) => librarySaveOf(item, version)) });
    if (!stillCurrent()) return refused;
    if ("refused" in answer) {
      if (batch.length === 1) {
        console.warn(
          `[corrente] your account refused "${batch[0].item.name}"; it stays on this device:`,
          answer.refused,
        );
        await from.refuse(batch[0].key, answer.refused);
        refused += 1;
      }
      size = 1;
      continue;
    }
    const sent = batch.map((save) => save.key);
    if (from !== into) await from.settle(sent, []);
    const stored = await into.settle(from === into ? sent : [], answer.entries, answer.cursor);
    // Stored in its own library either way; shown only while that library is the one open.
    if (stillCurrent()) receiveEntries(stored, mark);
    if (batch.length < size) return refused;
  }
  return refused;
}
