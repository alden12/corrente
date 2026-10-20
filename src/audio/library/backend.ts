/**
 * Where the library keeps its records (COMM-1.11): items, each with write-once versions. One shape
 * for every backend, so the on-device store and the account's tables (COMM-1.11.2) hold the same
 * records and a sign-in merge is a copy.
 *
 * - **An item** is what you see in the library: its name, which version is current, and whether it
 *   was deleted (`hiddenAt`, kept so what refers to it still resolves).
 * - **A version** is written once and never changed. Saving over an item adds the next one; its tags
 *   and description are written with it, so they describe the sound they sit beside.
 */
import type { Author } from "../commands/types";
import type { CustomKind } from "../definitions/custom";

/** What an item holds: a patch, or a custom instrument or effect (COMM-1.9.8). */
export type LibraryKind = "patch" | CustomKind;

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  /** The current version's number. */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** When it was deleted. Its versions stay. */
  hiddenAt?: number;
}

export interface LibraryVersion {
  itemId: string;
  version: number;
  createdAt: number;
  author: Author;
  /** What it sounds like. */
  tags: string[];
  /** Why it exists: the brief, the song, the part. */
  description?: string;
  /** The item itself: for a patch, its instrument and chains. */
  document: unknown;
  /**
   * The document's content hash (contentHash.ts), worked out on the device and again by the account:
   * what a project's copy is matched against. Versions stored before the device hashed them are
   * hashed as the library opens.
   */
  hash: string;
}

/**
 * Which library version a project's copy of a device is (COMM-1.11.2). The hash is what matches;
 * the number is the account's, and may change when the account renumbers a version saved offline.
 */
export interface DeviceRef {
  version: number;
  hash: string;
}

/** An item with its current version. */
export interface LibraryEntry {
  item: LibraryItem;
  current: LibraryVersion;
}

export interface LibraryBackend {
  /** Every item, and each one's current version. */
  load(): Promise<{ items: LibraryItem[]; current: LibraryVersion[] }>;
  /** Write an item, and a new version of it when there is one. */
  save(item: LibraryItem, version?: LibraryVersion): Promise<void>;
}

/** A save not yet on the account: the item as it now stands, and the version saved, if one was. */
export interface QueuedSave {
  key: number;
  item: LibraryItem;
  version?: LibraryVersion;
}

/**
 * A backend whose saves wait in a queue for the account (COMM-1.11.2). What the account confirmed
 * and what it hasn't are kept apart: a queued version lives in the queue, numbered as this device
 * guessed, and only the account's own versions are stored as versions. So a save the account
 * numbers differently (another device took that number) never leaves a wrongly numbered copy.
 */
export interface LibraryOutbox {
  /** The oldest saves still to send, up to `limit`, leaving out any the account refused. */
  queued(limit: number): Promise<QueuedSave[]>;
  /** Where the last sync read up to. */
  cursor(): Promise<string | undefined>;
  /**
   * Settle a sync: drop the saves sent, and any refused save of the same item they superseded; store
   * what the account sent back, and the cursor to read from next. An item with saves still to go, or
   * whose latest save was refused, keeps this device's copy. Returns the entries it stored.
   */
  settle(sent: readonly number[], received: readonly LibraryEntry[], cursor?: string): Promise<LibraryEntry[]>;
  /** Keep a save the account refused, unsent, so it stays here and stops blocking the rest. */
  refuse(key: number, reason: string): Promise<void>;
  /** Whether nothing is queued, refused saves included: everything it held has reached an account. */
  isEmpty(): Promise<boolean>;
  /** Empty it: once what it held has moved into an account. */
  clear(): Promise<void>;
}

/** Records held in memory only: where there's no storage (Node, a private window), and in tests. */
export function memoryBackend(): LibraryBackend {
  const items = new Map<string, LibraryItem>();
  const versions = new Map<string, LibraryVersion>();
  const key = (itemId: string, version: number) => `${itemId}@${version}`;
  return {
    load: async () => ({
      items: [...items.values()],
      current: [...items.values()].flatMap((item) => versions.get(key(item.id, item.version)) ?? []),
    }),
    save: async (item, version) => {
      if (version && versions.has(key(version.itemId, version.version)))
        throw new Error(`Version ${version.version} of ${version.itemId} is already written.`);
      items.set(item.id, item);
      if (version) versions.set(key(version.itemId, version.version), version);
    },
  };
}
