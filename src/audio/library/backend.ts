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

/** What an item holds. Patches first; custom instruments and effects join them (COMM-1.11.1). */
export type LibraryKind = "patch";

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
}

export interface LibraryBackend {
  /** Every item, and each one's current version. */
  load(): Promise<{ items: LibraryItem[]; current: LibraryVersion[] }>;
  /** Write an item, and a new version of it when there is one. */
  save(item: LibraryItem, version?: LibraryVersion): Promise<void>;
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
