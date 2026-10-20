/**
 * The patch library: a user's saved instrument *patches* - an instrument type plus its parameter
 * values and MIDI-device and effect chains, captured as a named, reusable preset. Patches are
 * **global** (shared across all projects), so they live in the library (COMM-1.11) rather than a
 * project: on the device in IndexedDB, as items with write-once versions (library/store.ts). Saving
 * over a patch adds a version; deleting one hides it. A patch made on a custom instrument, or with
 * custom effects, carries their definitions, so it plays in a project that doesn't have them.
 *
 * A patch stores effects *without* instance ids - ids are per-track and are minted
 * fresh when a patch is applied (see `createTrackFromPatch`), so the same patch can
 * be dropped onto many tracks. Applying a patch is one authored edit, so it is
 * undoable, two-voice, and replayable like any other.
 */
import type { Author } from "../commands/types";
import type { PatchValues } from "../params/types";
import { randomUuid } from "../randomUuid";
import type { Tag } from "../tags";
import { z } from "zod";
import { authorSchema, patchValuesSchema } from "../project/schema";
import type { LibraryBackend } from "../library/backend";
import {
  hideItem,
  libraryEntries,
  libraryEntry,
  libraryWritten,
  openStore,
  saveItem,
  subscribeLibrary,
  type LibraryEntry,
} from "../library/store";
import type { SoundDevices } from "./sound";

/** One effect in a saved patch: its type, bypass state, and parameter values. */
export interface PatchEffect {
  type: string;
  bypassed?: boolean;
  params: PatchValues;
}

/** One MIDI device in a saved patch (same idless shape as PatchEffect). */
export interface PatchMidiDevice {
  type: string;
  bypassed?: boolean;
  params: PatchValues;
}

/** A saved instrument preset: instrument + params + MIDI-device + effect chains, named by the user. */
export interface Patch {
  id: string;
  name: string;
  author: Author;
  instrumentType: string;
  params: PatchValues;
  effects: PatchEffect[];
  /** MIDI-device chain (note transforms). Optional: patches saved before this default to none. */
  midiDevices?: PatchMidiDevice[];
  createdAt: number;
  /** True for a shipped factory preset (read-only, in code - see factory.ts). */
  builtin?: boolean;
  /** What it sounds like: its role first ("pad"), then its character ("dark"). Any string. */
  tags?: readonly Tag[];
  /** Why it exists: the brief, the song, the part it was made for. Not how it sounds (that's tags). */
  description?: string;
  /** Which version of it this is: a library patch's count of saves. */
  version?: number;
  /** The custom devices it plays, carried so it plays in any project. */
  devices?: SoundDevices;
}

/** What a library version holds for a patch: its sound, without the library's metadata. */
type PatchDocument = Pick<Patch, "instrumentType" | "params" | "effects" | "midiDevices" | "devices">;

/** Where patches were kept before the library, moved in on first open. */
const OLD_STORAGE_KEY = "corrente:patches:v1";

const patchOf = ({ item, current }: LibraryEntry): Patch => ({
  id: item.id,
  name: item.name,
  author: current.author,
  createdAt: item.createdAt,
  version: item.version,
  tags: current.tags,
  ...(current.description ? { description: current.description } : {}),
  ...(current.document as PatchDocument),
});

export { libraryWritten };

/** Every saved patch, newest first, deleted ones left out. Empty until the library opens. */
export const listPatches = (): Patch[] => libraryEntries("patch").map(patchOf);

/** Save a patch, and say when it's stored. */
function stored(patch: Patch, at: number): { saved: Patch; written: Promise<void> } {
  const document: PatchDocument = {
    instrumentType: patch.instrumentType,
    params: patch.params,
    effects: patch.effects,
    midiDevices: patch.midiDevices ?? [],
    ...(patch.devices ? { devices: patch.devices } : {}),
  };
  const { entry, written } = saveItem({ ...patch, kind: "patch", document }, at);
  return { saved: patchOf(entry), written };
}

/**
 * Save a patch: a new one, or a new version of one already saved (by id), its tags and description
 * written with it. Returns it as saved.
 */
export function savePatch(patch: Patch, at = Date.now()): Patch {
  const { saved, written } = stored(patch, at);
  void written.catch(() => {}); // the queue has warned
  return saved;
}

/** Delete a patch: hidden from the library, its versions kept. */
export const removePatch = (id: string): void => hideItem(id);

/** Subscribe to library changes (save/remove). Returns an unsubscribe fn. */
export const subscribePatches = subscribeLibrary;

/** A fresh patch id. */
export function newPatchId(): string {
  return `pt-${randomUuid().slice(0, 8)}`;
}

/** One device in a patch as localStorage kept it. */
const oldChainSchema = z.object({ type: z.string(), bypassed: z.boolean().optional(), params: patchValuesSchema });

/** A patch as localStorage kept it, checked before it moves in: it was written by older builds. */
const oldPatchSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  author: authorSchema,
  instrumentType: z.string(),
  params: patchValuesSchema,
  effects: z.array(oldChainSchema),
  midiDevices: z.array(oldChainSchema).optional(),
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
    await Promise.all(moving.map((patch) => stored(patch, patch.createdAt).written));
    // An entry that didn't read keeps the key, so nothing is thrown away unseen.
    if (complete) localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // A write failed: the old key stays, so the next open tries again and nothing is lost.
  }
}
