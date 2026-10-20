/**
 * The library on the device (COMM-1.11.1): IndexedDB, which every browser has and which survives a
 * reload, signed in or not. One database per account, and one for signed out (COMM-1.11.2).
 *
 * - `items`, keyed by id.
 * - `versions`: the versions the account confirmed, keyed by (item, version) and numbered as the
 *   account numbered them, with an index over their tags.
 * - `queue`: saves not yet on the account, oldest first, each version as this device numbered it
 *   (`LibraryOutbox`). Signed out, that's every save: nothing is confirmed until an account has it.
 * - `meta`: where the last sync read up to.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LibraryBackend, LibraryItem, LibraryOutbox, LibraryVersion, QueuedSave } from "./backend";

/** A save waiting for the account: the item it changed, the version it added, and why the account refused it, if it did. */
interface QueueRow {
  itemId: string;
  version?: LibraryVersion;
  refused?: string;
}

interface LibrarySchema extends DBSchema {
  items: { key: string; value: LibraryItem };
  versions: { key: [string, number]; value: LibraryVersion; indexes: { tags: string } };
  queue: { key: number; value: QueueRow };
  meta: { key: string; value: string };
}

const STORES = ["items", "versions", "queue", "meta"] as const;

/** The database an account's library lives in; `local` is signed out's. */
export const libraryDatabase = (owner: string): string =>
  owner === "local" ? "corrente-library" : `corrente-library:${owner}`;

function backendOf(database: IDBPDatabase<LibrarySchema>): LibraryBackend & LibraryOutbox {
  return {
    load: async () => {
      const transaction = database.transaction(["items", "versions", "queue"]);
      const [items, queue] = await Promise.all([
        transaction.objectStore("items").getAll(),
        transaction.objectStore("queue").getAll(),
      ]);
      // An item's latest queued version, where it has one, is newer than any confirmed.
      const queuedOf = new Map(queue.flatMap((row) => (row.version ? [[row.itemId, row.version] as const] : [])));
      const versions = transaction.objectStore("versions");
      const current = await Promise.all(
        items.map((item) => queuedOf.get(item.id) ?? versions.get([item.id, item.version])),
      );
      return { items, current: current.filter((version) => version !== undefined) };
    },
    save: async (item, version) => {
      const transaction = database.transaction(["items", "queue"], "readwrite");
      await Promise.all([
        transaction.objectStore("items").put(item),
        transaction.objectStore("queue").add({ itemId: item.id, ...(version ? { version } : {}) }),
        transaction.done,
      ]);
    },
    queued: async (limit) => {
      const transaction = database.transaction(["items", "queue"]);
      const queue = transaction.objectStore("queue");
      const [keys, rows] = await Promise.all([queue.getAllKeys(), queue.getAll()]);
      const waiting = rows
        .map((row, index) => ({ key: keys[index], row }))
        .filter(({ row }) => row.refused === undefined)
        .slice(0, limit);
      const items = transaction.objectStore("items");
      const saves = await Promise.all(
        waiting.map(async ({ key, row }): Promise<QueuedSave | undefined> => {
          const item = await items.get(row.itemId);
          return item && { key, item, ...(row.version ? { version: row.version } : {}) };
        }),
      );
      return saves.filter((save) => save !== undefined);
    },
    cursor: () => database.get("meta", "cursor"),
    settle: async (sent, received, cursor) => {
      const transaction = database.transaction(["items", "versions", "queue", "meta"], "readwrite");
      const queue = transaction.objectStore("queue");
      await Promise.all(sent.map((key) => queue.delete(key)));
      const stillQueued = new Set((await queue.getAll()).map((row) => row.itemId));
      const kept = received.filter((entry) => !stillQueued.has(entry.item.id));
      await Promise.all([
        ...kept.flatMap((entry) => [
          transaction.objectStore("items").put(entry.item),
          transaction.objectStore("versions").put(entry.current),
        ]),
        ...(cursor === undefined ? [] : [transaction.objectStore("meta").put(cursor, "cursor")]),
        transaction.done,
      ]);
      return kept;
    },
    refuse: async (key, reason) => {
      const transaction = database.transaction("queue", "readwrite");
      const row = await transaction.store.get(key);
      await Promise.all([...(row ? [transaction.store.put({ ...row, refused: reason }, key)] : []), transaction.done]);
    },
    clear: async () => {
      const transaction = database.transaction(STORES, "readwrite");
      await Promise.all([...STORES.map((store) => transaction.objectStore(store).clear()), transaction.done]);
    },
  };
}

/** An account's library on the device (signed out's by default), or undefined where IndexedDB is missing or refuses to open. */
export async function indexedDbBackend(
  name = libraryDatabase("local"),
): Promise<(LibraryBackend & LibraryOutbox) | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const database = await openDB<LibrarySchema>(name, 2, {
      async upgrade(upgrading, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          upgrading.createObjectStore("items", { keyPath: "id" });
          const versions = upgrading.createObjectStore("versions", { keyPath: ["itemId", "version"] });
          versions.createIndex("tags", "tags", { multiEntry: true });
        }
        if (oldVersion < 2) {
          upgrading.createObjectStore("queue", { autoIncrement: true });
          upgrading.createObjectStore("meta");
        }
        if (oldVersion === 1) {
          // Version 1 was signed out only, so no account has confirmed any of its versions: they
          // move into the queue, oldest first, to go to the account on sign-in.
          const versions = transaction.objectStore("versions");
          const saved = (await versions.getAll()).sort((left, right) => left.createdAt - right.createdAt);
          const queue = transaction.objectStore("queue");
          await Promise.all(saved.map((version) => queue.add({ itemId: version.itemId, version })));
          await versions.clear();
        }
      },
    });
    // Another tab opening a newer version (or deleting it) waits on this one: step aside.
    database.addEventListener("versionchange", () => database.close());
    return backendOf(database);
  } catch {
    return undefined;
  }
}
