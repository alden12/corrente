/**
 * The library in memory (COMM-1.11.1): every item with its current version, loaded once from a
 * backend (`openStore`) so reads stay synchronous, and every change written through to the backend
 * in order. Patches (patches/library.ts) and custom devices (devices.ts) are views over it.
 */
import { createListeners } from "../../listeners";
import type { Author } from "../commands/types";
import { documentHash } from "../contentHash";
import { sameVersion } from "./schema";
import {
  memoryBackend,
  type LibraryBackend,
  type LibraryEntry,
  type LibraryItem,
  type LibraryKind,
  type LibraryVersion,
} from "./backend";

export type { LibraryEntry };

/** What saving an item takes: the item's identity, and the new version's contents. */
export interface ItemDraft {
  id: string;
  kind: LibraryKind;
  name: string;
  author: Author;
  tags?: readonly string[];
  description?: string;
  document: unknown;
  /** When it was first made, for an item new to the library. */
  createdAt: number;
}

const listeners = createListeners();

let backend: LibraryBackend = memoryBackend();
const entries = new Map<string, LibraryEntry>();
/** How many changes this device has made, and the count at each item's latest: see `libraryMark`. */
let changes = 0;
const changedAt = new Map<string, number>();

/** The backend's writes, one after another, so a version never lands before its item's last. */
let writes: Promise<void> = Promise.resolve();

/** Queue a write; the returned promise says whether it landed, and a failure doesn't stop the queue. */
function write(target: LibraryBackend, item: LibraryItem, version?: LibraryVersion): Promise<void> {
  const written = writes.then(() => target.save(item, version));
  writes = written.catch((error: unknown) => console.warn("[corrente] the library couldn't save:", error));
  return written;
}

/** Until the library has been written, for tests and anything that must see it stored. */
export const libraryWritten = (): Promise<void> => writes;

/** Which open is the latest, so a slower load of one switched away from doesn't land over it. */
let opening = 0;

/**
 * Load the library from `chosen`, and write to it from now on: at start, and on switching account.
 * Writes queued for the last backend land there first.
 */
export async function openStore(chosen: LibraryBackend): Promise<void> {
  const thisOpen = ++opening;
  await writes;
  backend = chosen;
  const { items, current } = await chosen.load();
  if (thisOpen !== opening) return;
  // Versions saved before the device hashed them get their hash now: it's what a project matches on.
  const hashed = await Promise.all(
    current.map(async (version) =>
      version.hash ? version : { ...version, hash: await documentHash(version.document) },
    ),
  );
  if (thisOpen !== opening) return;
  const currentOf = new Map(hashed.map((version) => [version.itemId, version]));
  entries.clear();
  items.forEach((item) => {
    const version = currentOf.get(item.id);
    if (version) entries.set(item.id, { item, current: version });
  });
  listeners.emit();
}

/**
 * A point in this device's changes. A sync takes one before it reads its queue, so what the account
 * sends back can't replace a change made after it (which the next sync sends).
 */
export const libraryMark = (): number => changes;

/** Take in entries the account sent back (already stored by the backend), skipping any changed since `mark`. */
export function receiveEntries(received: readonly LibraryEntry[], mark: number): void {
  const taken = received.filter((entry) => (changedAt.get(entry.item.id) ?? 0) <= mark);
  if (!taken.length) return;
  taken.forEach((entry) => entries.set(entry.item.id, entry));
  listeners.emit();
}

/** One item, deleted or not. */
export const libraryEntry = (id: string): LibraryEntry | undefined => entries.get(id);

/** The items of a kind, newest first, deleted ones left out. */
export const libraryEntries = (kind: LibraryKind): LibraryEntry[] =>
  [...entries.values()]
    .filter(({ item }) => item.kind === kind && item.hiddenAt === undefined)
    .sort((left, right) => right.item.updatedAt - left.item.updatedAt);

/**
 * Save an item as its next version (its first, if new), resolving once its document is hashed and
 * the save stored. A save that changes nothing about the current version adds none: a new name, or
 * bringing back a deleted item, rewrites the item alone, and an identical save is the current entry.
 */
export async function saveItem(draft: ItemDraft, at = Date.now()): Promise<LibraryEntry> {
  // The library it was made in, even if another account's opens while it's hashed.
  const target = backend;
  const hash = await documentHash(draft.document);
  // Switched meanwhile: memory is the other account's now, so the save goes to its own library
  // alone, numbered as a first guess (the account numbers it).
  const switched = backend !== target;
  const existing = switched ? undefined : entries.get(draft.id);
  const unchanged =
    existing !== undefined &&
    sameVersion(existing.current, { hash, tags: draft.tags ?? [], description: draft.description });
  if (unchanged && existing.item.name === draft.name && existing.item.hiddenAt === undefined) return existing;
  const version = unchanged ? existing.item.version : (existing?.item.version ?? 0) + 1;
  const item: LibraryItem = {
    id: draft.id,
    kind: draft.kind,
    name: draft.name,
    version,
    createdAt: existing?.item.createdAt ?? draft.createdAt,
    updatedAt: at,
  };
  const current: LibraryVersion = unchanged
    ? existing.current
    : {
        itemId: draft.id,
        version,
        createdAt: at,
        author: draft.author,
        tags: [...(draft.tags ?? [])],
        ...(draft.description ? { description: draft.description } : {}),
        document: draft.document,
        hash,
      };
  const entry = { item, current };
  if (!switched) {
    entries.set(draft.id, entry);
    changedAt.set(draft.id, ++changes);
    listeners.emit();
  }
  try {
    await write(target, item, unchanged ? undefined : current);
  } catch (error) {
    // Not stored, so not shown as saved: back to what was there, unless a later save replaced it.
    if (!switched && entries.get(draft.id) === entry) {
      if (existing) entries.set(draft.id, existing);
      else entries.delete(draft.id);
      listeners.emit();
    }
    throw error;
  }
  return entry;
}

/** Delete an item: hidden from the library, its versions kept. */
export function hideItem(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  const item = { ...entry.item, hiddenAt: Date.now() };
  entries.set(id, { ...entry, item });
  changedAt.set(id, ++changes);
  void write(backend, item).catch(() => {}); // the queue has warned
  listeners.emit();
}

/** Subscribe to library changes. Returns an unsubscribe fn. */
export const subscribeLibrary = listeners.subscribe;
