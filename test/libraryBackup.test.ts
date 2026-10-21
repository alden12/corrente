import { beforeEach, describe, expect, it } from "vitest";
import { memoryBackend } from "../src/audio/library/backend";
import { libraryEntry } from "../src/audio/library/store";
import { newPatchId, openLibrary, removePatch, savePatch } from "../src/audio/patches/library";
import {
  describeLibraryRestore,
  libraryBackup,
  libraryBackupFileName,
  readLibraryBackup,
  restoreLibrary,
} from "../src/audio/library/backup";

const patch = (name: string, cutoff = 1200, id = newPatchId()) => ({
  id,
  name,
  author: "you" as const,
  instrumentType: "subtractive",
  params: { "filter.cutoff": cutoff },
  effects: [],
  createdAt: 1,
});

/** Favourites as the store keeps them, in a set. */
const favouritesOf = (refs: string[] = []) => {
  const held = new Set(refs);
  return { held, has: (ref: string) => held.has(ref), add: (ref: string) => void held.add(ref) };
};

/** A backup as it's saved and read back: through the file's text. */
const roundTrip = (favourites: string[] = []) => readLibraryBackup(JSON.stringify(libraryBackup(favourites)));

describe("backing up the library (HOST-23.2.1.2)", () => {
  beforeEach(async () => openLibrary(memoryBackend()));

  it("names the file by day, and holds each item's current version, deleted ones left out", async () => {
    expect(libraryBackupFileName(new Date(2026, 9, 21))).toBe("corrente-library-2026-10-21.json");
    const kept = await savePatch(patch("Warm Pad"));
    const gone = await savePatch(patch("Gone"));
    removePatch(gone.id);
    const backup = roundTrip(["builtin:subtractive"]);
    expect(backup.items.map((save) => save.item.id)).toEqual([kept.id]);
    expect(backup.favourites).toEqual(["builtin:subtractive"]);
  });

  it("restores everything into an empty library, favourites too", async () => {
    const pad = await savePatch(patch("Warm Pad"));
    const backup = roundTrip(["builtin:subtractive"]);

    await openLibrary(memoryBackend()); // a new device
    const favourites = favouritesOf();
    const result = await restoreLibrary(backup, favourites);
    expect(result).toEqual({ added: 1, updated: 0, kept: 0, favourites: 1 });
    expect(libraryEntry(pad.id)?.item.name).toBe("Warm Pad");
    expect(favourites.held.has("builtin:subtractive")).toBe(true);
  });

  it("keeps what's here when it's the same or newer, and takes the backup's when that's newer", async () => {
    const id = newPatchId();
    await savePatch(patch("Pad", 1200, id), 100);
    const older = roundTrip();
    await savePatch(patch("Pad", 900, id), 200);
    const newer = roundTrip();

    expect(await restoreLibrary(newer, favouritesOf())).toMatchObject({ kept: 1 }); // the same
    expect(await restoreLibrary(older, favouritesOf())).toMatchObject({ kept: 1 }); // older than here
    expect(libraryEntry(id)?.current.document).toMatchObject({ params: { "filter.cutoff": 900 } });

    await openLibrary(memoryBackend());
    await restoreLibrary(older, favouritesOf());
    expect(await restoreLibrary(newer, favouritesOf())).toMatchObject({ updated: 1 });
    expect(libraryEntry(id)?.current.document).toMatchObject({ params: { "filter.cutoff": 900 } });
  });

  it("leaves an item deleted here since the backup deleted", async () => {
    const pad = await savePatch(patch("Pad"), 100);
    const backup = roundTrip();
    removePatch(pad.id);
    expect(await restoreLibrary(backup, favouritesOf())).toMatchObject({ kept: 1 });
    expect(libraryEntry(pad.id)?.item.hiddenAt).toBeDefined();
  });

  it("refuses what isn't a library backup, or is from a newer app", () => {
    expect(() => readLibraryBackup(JSON.stringify({ hello: "world" }))).toThrow(/isn't a Corrente library backup/);
    const future = { kind: "corrente-library", formatVersion: 99, createdAt: "", items: [] };
    expect(() => readLibraryBackup(JSON.stringify(future))).toThrow(/newer version of Corrente/);
  });

  it("sums a restore up in a sentence", () => {
    expect(describeLibraryRestore({ added: 3, updated: 1, kept: 5, favourites: 2 })).toBe(
      "Library restored: added 3, updated 1, kept 5 as they were and added 2 favourites.",
    );
    expect(describeLibraryRestore({ added: 0, updated: 0, kept: 0, favourites: 0 })).toBe(
      "There was nothing in that backup.",
    );
  });
});
