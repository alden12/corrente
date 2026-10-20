/**
 * The library on the device (COMM-1.11.1): IndexedDB, which every browser has and which survives a
 * reload, signed in or not. Items keyed by id; versions by (item, version), added and never put, so
 * a version can't be overwritten; and an index over each version's tags, for looking them up by tag.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LibraryBackend, LibraryItem, LibraryVersion } from "./backend";

interface LibrarySchema extends DBSchema {
  items: { key: string; value: LibraryItem };
  versions: { key: [string, number]; value: LibraryVersion; indexes: { tags: string } };
}

const DATABASE = "corrente-library";

function backendOf(database: IDBPDatabase<LibrarySchema>): LibraryBackend {
  return {
    load: async () => {
      const transaction = database.transaction(["items", "versions"]);
      const items = await transaction.objectStore("items").getAll();
      const versions = transaction.objectStore("versions");
      const current = await Promise.all(items.map((item) => versions.get([item.id, item.version])));
      return { items, current: current.filter((version) => version !== undefined) };
    },
    save: async (item, version) => {
      const transaction = database.transaction(["items", "versions"], "readwrite");
      await Promise.all([
        transaction.objectStore("items").put(item),
        ...(version ? [transaction.objectStore("versions").add(version)] : []),
        transaction.done,
      ]);
    },
  };
}

/** The device's library, or undefined where IndexedDB is missing or refuses to open. */
export async function indexedDbBackend(): Promise<LibraryBackend | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const database = await openDB<LibrarySchema>(DATABASE, 1, {
      upgrade(upgrading) {
        upgrading.createObjectStore("items", { keyPath: "id" });
        const versions = upgrading.createObjectStore("versions", { keyPath: ["itemId", "version"] });
        versions.createIndex("tags", "tags", { multiEntry: true });
      },
    });
    // Another tab opening a newer version (or deleting it) waits on this one: step aside.
    database.addEventListener("versionchange", () => database.close());
    return backendOf(database);
  } catch {
    return undefined;
  }
}
