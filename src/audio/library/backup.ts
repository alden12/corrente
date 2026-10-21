/**
 * Back up the library to one small file, and restore from it (HOST-23.2.1.2): patches, custom devices
 * and favourites, which without an account live only in this browser. Projects aren't in it: each has
 * its own export, which carries the custom devices it uses.
 *
 * Each item is kept as its current version, in the shape a device sends the account (`LibrarySave`),
 * so restoring checks it the same way: a patch's shape, and every custom device compiled.
 *
 * Restoring saves through the library like any save, so it's queued for the account like one. It
 * never loses work: an item here that's newer than the backup's, or deleted since, stays as it is.
 */
import { z } from "zod";
import { documentHash } from "../contentHash";
import { libraryEntries, libraryEntry, saveItem } from "./store";
import { librarySaveOf, librarySaveSchema, type LibrarySave } from "./schema";
import type { LibraryKind } from "./backend";

const KINDS: LibraryKind[] = ["patch", "instrument", "effect"];
const FORMAT = 1;

const libraryBackupSchema = z.object({
  kind: z.literal("corrente-library"),
  formatVersion: z.number().int(),
  createdAt: z.string(),
  items: z.array(librarySaveSchema),
  favourites: z.array(z.string()).default([]),
});

export type LibraryBackup = z.infer<typeof libraryBackupSchema>;

/** `corrente-library-2026-10-21.json`, by the day it was made (local time). */
export const libraryBackupFileName = (date: Date): string =>
  `corrente-library-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}.json`;

/** The library as it stands, deleted items left out, with the favourites given. */
export const libraryBackup = (favourites: readonly string[], now: Date = new Date()): LibraryBackup => ({
  kind: "corrente-library",
  formatVersion: FORMAT,
  createdAt: now.toISOString(),
  items: KINDS.flatMap((kind) => libraryEntries(kind)).map(({ item, current }) => librarySaveOf(item, current)),
  favourites: [...favourites],
});

/** A backup file's contents, checked: an untrusted file. Throws, with what's wrong, on one that isn't. */
export function readLibraryBackup(text: string): LibraryBackup {
  const parsed = libraryBackupSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("That isn't a Corrente library backup.");
  if (parsed.data.formatVersion > FORMAT)
    throw new Error("This backup was made by a newer version of Corrente. Update the app to open it.");
  return parsed.data;
}

/** What a restore did: items added, brought up to the backup's, and left as they were; favourites added. */
export interface LibraryRestore {
  added: number;
  updated: number;
  kept: number;
  favourites: number;
}

type Outcome = "added" | "updated" | "kept";

/** What to do with one backed-up item, by the one here with its id. */
async function outcomeOf(save: LibrarySave): Promise<Outcome> {
  const here = libraryEntry(save.item.id);
  const version = save.version;
  if (!version) return "kept";
  if (!here) return "added";
  // Deleted here since: it stays deleted, unless the backup's version came after the delete.
  if (here.item.hiddenAt !== undefined) return version.createdAt > here.item.hiddenAt ? "updated" : "kept";
  if ((await documentHash(version.document)) === here.current.hash) return "kept";
  return version.createdAt > here.current.createdAt ? "updated" : "kept";
}

/**
 * Restore a backup into the library, item by item, and add its favourites to `favourites` (the
 * favourites store's own add, so this stays clear of the UI).
 */
export async function restoreLibrary(
  backup: LibraryBackup,
  favourites: { has: (ref: string) => boolean; add: (ref: string) => void },
): Promise<LibraryRestore> {
  const result: LibraryRestore = { added: 0, updated: 0, kept: 0, favourites: 0 };
  for (const save of backup.items) {
    const outcome = await outcomeOf(save);
    // Saved as of when it was made, not now, so what's newest still compares truly afterwards.
    if (outcome !== "kept" && save.version)
      await saveItem(
        {
          id: save.item.id,
          kind: save.item.kind,
          name: save.item.name,
          author: save.version.author,
          tags: save.version.tags,
          description: save.version.description,
          document: save.version.document,
          createdAt: save.item.createdAt,
        },
        save.version.createdAt,
      );
    result[outcome] += 1;
  }
  const missing = [...new Set(backup.favourites)].filter((ref) => !favourites.has(ref));
  missing.forEach(favourites.add);
  return { ...result, favourites: missing.length };
}

/** "Added 3 and updated 1, kept 5 as they were, and added 2 favourites." */
export function describeLibraryRestore({ added, updated, kept, favourites }: LibraryRestore): string {
  const items = added + updated + kept;
  if (!items && !favourites) return "There was nothing in that backup.";
  const parts = [
    added && `added ${added}`,
    updated && `updated ${updated}`,
    kept && `kept ${kept} as ${kept === 1 ? "it was" : "they were"}`,
    favourites && `added ${favourites} ${favourites === 1 ? "favourite" : "favourites"}`,
  ].filter((part): part is string => Boolean(part));
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Library restored: ${text}.`;
}
