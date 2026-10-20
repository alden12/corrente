/**
 * The library in memory (COMM-1.11.1): every item with its current version, loaded once from a
 * backend (`openStore`) so reads stay synchronous, and every change written through to the backend
 * in order. Patches (patches/library.ts) and custom devices (devices.ts) are views over it.
 */
import type { Author } from "../commands/types";
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

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

let backend: LibraryBackend = memoryBackend();
const entries = new Map<string, LibraryEntry>();
/** How many changes this device has made, and the count at each item's latest: see `libraryMark`. */
let changes = 0;
const changedAt = new Map<string, number>();

/** The backend's writes, one after another, so a version never lands before its item's last. */
let writes: Promise<void> = Promise.resolve();

/** Queue a write; the returned promise says whether it landed, and a failure doesn't stop the queue. */
function write(item: LibraryItem, version?: LibraryVersion): Promise<void> {
  const written = writes.then(() => backend.save(item, version));
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
  const currentOf = new Map(current.map((version) => [version.itemId, version]));
  entries.clear();
  items.forEach((item) => {
    const version = currentOf.get(item.id);
    if (version) entries.set(item.id, { item, current: version });
  });
  notify();
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
  notify();
}

/** One item, deleted or not. */
export const libraryEntry = (id: string): LibraryEntry | undefined => entries.get(id);

/** The items of a kind, newest first, deleted ones left out. */
export const libraryEntries = (kind: LibraryKind): LibraryEntry[] =>
  [...entries.values()]
    .filter(({ item }) => item.kind === kind && item.hiddenAt === undefined)
    .sort((left, right) => right.item.updatedAt - left.item.updatedAt);

/** Save an item as its next version (its first, if new), and say when it's stored. */
export function saveItem(draft: ItemDraft, at = Date.now()): { entry: LibraryEntry; written: Promise<void> } {
  const existing = entries.get(draft.id);
  const version = (existing?.item.version ?? 0) + 1;
  const item: LibraryItem = {
    id: draft.id,
    kind: draft.kind,
    name: draft.name,
    version,
    createdAt: existing?.item.createdAt ?? draft.createdAt,
    updatedAt: at,
  };
  const current: LibraryVersion = {
    itemId: draft.id,
    version,
    createdAt: at,
    author: draft.author,
    tags: [...(draft.tags ?? [])],
    ...(draft.description ? { description: draft.description } : {}),
    document: draft.document,
  };
  const entry = { item, current };
  entries.set(draft.id, entry);
  changedAt.set(draft.id, ++changes);
  const written = write(item, current);
  notify();
  return { entry, written };
}

/** Delete an item: hidden from the library, its versions kept. */
export function hideItem(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  const item = { ...entry.item, hiddenAt: Date.now() };
  entries.set(id, { ...entry, item });
  changedAt.set(id, ++changes);
  void write(item).catch(() => {}); // the queue has warned
  notify();
}

/** Subscribe to library changes. Returns an unsubscribe fn. */
export function subscribeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
