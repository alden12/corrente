/**
 * The patch library: a user's saved instrument *patches* - an instrument type plus its parameter
 * values and MIDI-device and effect chains, captured as a named, reusable preset. Patches are
 * **global** (shared across all projects), so they live in the library (COMM-1.11) rather than a
 * project: on the device in IndexedDB, as items with write-once versions (library/store.ts). Saving
 * over a patch adds a version; deleting one hides it. A patch made on a custom instrument, or with
 * custom effects, carries their definitions, so it plays in a project that doesn't have them.
 * The shape and pure helpers are patch.ts, which the servers use without this store.
 */
import type { Author } from "../commands/types";
import { z } from "zod";
import { authorSchema, patchValuesSchema } from "../project/schema";
import { patchChainSchema } from "../library/schema";
import type { LibraryBackend } from "../library/backend";
import {
  hideItem,
  libraryEntries,
  libraryEntry,
  libraryWritten,
  openStore,
  saveItem,
  subscribeLibrary,
} from "../library/store";
import { keepDevice } from "../library/devices";
import type { InstrumentTrack } from "../project/projectStore";
import { patchDocumentOf, patchOf, type Patch } from "./patch";
import { patchFromTrack } from "./patchTools";
import type { DeviceSource } from "./sound";
import type { SaveOptions } from "./toolSpec";

export type { Patch, PatchDocument, PatchEffect, PatchMidiDevice } from "./patch";
export { newPatchId } from "./patch";

/** Where patches were kept before the library, moved in on first open. */
const OLD_STORAGE_KEY = "corrente:patches:v1";

export { libraryWritten };

/** Every saved patch, newest first, deleted ones left out. Empty until the library opens. */
export const listPatches = (): Patch[] => libraryEntries("patch").map(patchOf);

/**
 * Save a patch: a new one, or a new version of one already saved (by id), its tags and description
 * written with it. Resolves to it as saved, once it's stored.
 */
export async function savePatch(patch: Patch, at = Date.now()): Promise<Patch> {
  return patchOf(await saveItem({ ...patch, kind: "patch", document: patchDocumentOf(patch) }, at));
}

/** Delete a patch: hidden from the library, its versions kept. */
export const removePatch = (id: string): void => hideItem(id);

/** Subscribe to library changes (save/remove). Returns an unsubscribe fn. */
export const subscribePatches = subscribeLibrary;

/**
 * Save a track's sound to the library on this device, as a new patch or a new version of one of the
 * user's. Its custom devices go with it, and into the library on their own (COMM-1.11.1).
 */
export async function savePatchFromTrack(
  track: InstrumentTrack,
  author: Author,
  project: DeviceSource,
  options: SaveOptions = {},
): Promise<Patch> {
  const patch = patchFromTrack(track, author, project, listPatches(), options);
  await Promise.all([
    ...(patch.devices?.instruments ?? []).map((device) => keepDevice("instrument", device, author)),
    ...(patch.devices?.effects ?? []).map((device) => keepDevice("effect", device, author)),
  ]);
  return savePatch(patch);
}

/** A patch as localStorage kept it, checked before it moves in: it was written by older builds. */
const oldPatchSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  author: authorSchema,
  instrumentType: z.string(),
  params: patchValuesSchema,
  effects: z.array(patchChainSchema),
  midiDevices: z.array(patchChainSchema).optional(),
  createdAt: z.number(),
});

/**
 * The patches kept in localStorage before the library, oldest first, and whether every entry read
 * cleanly; none when there's no storage or nothing kept.
 */
function oldPatches(): { patches: Patch[]; complete: boolean } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) ?? "[]");
    const entries = Array.isArray(raw) ? raw : [];
    const patches = entries.flatMap((entry) => {
      const parsed = oldPatchSchema.safeParse(entry);
      return parsed.success ? [parsed.data as Patch] : [];
    });
    return { patches: patches.reverse(), complete: Array.isArray(raw) && patches.length === entries.length };
  } catch {
    return { patches: [], complete: false };
  }
}

/**
 * Load the library from `chosen` and use it from now on. The first time, patches kept in
 * localStorage before the library move in, each as its first version, and the old key goes once
 * they're all stored.
 */
export async function openLibrary(chosen: LibraryBackend): Promise<void> {
  await openStore(chosen);
  const { patches, complete } = oldPatches();
  if (!patches.length) return;
  try {
    const moving = patches.filter((patch) => !libraryEntry(patch.id));
    await Promise.all(moving.map((patch) => savePatch(patch, patch.createdAt)));
    // An entry that didn't read keeps the key, so nothing is thrown away unseen.
    if (complete) localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // A write failed: the old key stays, so the next open tries again and nothing is lost.
  }
}
