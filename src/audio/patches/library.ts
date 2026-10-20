/**
 * The patch library: a user's saved instrument *patches* - an instrument type plus its parameter
 * values and MIDI-device and effect chains, captured as a named, reusable preset. Patches are
 * **global** (shared across all projects), so they live in the library (COMM-1.11) rather than a
 * project: on the device in IndexedDB, as items with write-once versions. Saving over a patch adds a
 * version; deleting one hides it. Reads come from a copy in memory, loaded once (`openLibrary`), so
 * they stay synchronous; writes go through to the backend in order.
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
import { memoryBackend, type LibraryBackend, type LibraryItem, type LibraryVersion } from "../library/backend";

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
}

/** What a library version holds for a patch: its sound, without the library's metadata. */
type PatchDocument = Pick<Patch, "instrumentType" | "params" | "effects" | "midiDevices">;

/** Where patches were kept before the library, moved in on first open. */
const OLD_STORAGE_KEY = "corrente:patches:v1";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

let backend: LibraryBackend = memoryBackend();
/** Every patch in the library, with its current version. */
const entries = new Map<string, { item: LibraryItem; current: LibraryVersion }>();
/** The backend's writes, one after another, so a version never lands before its item's last. */
let writes: Promise<void> = Promise.resolve();

const patchOf = ({ item, current }: { item: LibraryItem; current: LibraryVersion }): Patch => ({
  id: item.id,
  name: item.name,
  author: current.author,
  createdAt: item.createdAt,
  version: item.version,
  tags: current.tags,
  ...(current.description ? { description: current.description } : {}),
  ...(current.document as PatchDocument),
});

/** Queue a write; the returned promise says whether it landed, and a failure doesn't stop the queue. */
function write(item: LibraryItem, version?: LibraryVersion): Promise<void> {
  const written = writes.then(() => backend.save(item, version));
  writes = written.catch((error: unknown) => console.warn("[corrente] the patch library couldn't save:", error));
  return written;
}

/** Until the library has been written, for tests and anything that must see it stored. */
export const libraryWritten = (): Promise<void> => writes;

/** Every saved patch, newest first, deleted ones left out. Empty until the library opens. */
export function listPatches(): Patch[] {
  return [...entries.values()]
    .filter(({ item }) => item.hiddenAt === undefined)
    .sort((left, right) => right.item.updatedAt - left.item.updatedAt)
    .map(patchOf);
}

/** Save a patch, and say when it's stored. */
function stored(patch: Patch, at: number): { saved: Patch; written: Promise<void> } {
  const existing = entries.get(patch.id);
  const version = (existing?.item.version ?? 0) + 1;
  const item: LibraryItem = {
    id: patch.id,
    kind: "patch",
    name: patch.name,
    version,
    createdAt: existing?.item.createdAt ?? patch.createdAt,
    updatedAt: at,
  };
  const document: PatchDocument = {
    instrumentType: patch.instrumentType,
    params: patch.params,
    effects: patch.effects,
    midiDevices: patch.midiDevices ?? [],
  };
  const current: LibraryVersion = {
    itemId: patch.id,
    version,
    createdAt: at,
    author: patch.author,
    tags: [...(patch.tags ?? [])],
    ...(patch.description ? { description: patch.description } : {}),
    document,
  };
  entries.set(patch.id, { item, current });
  const written = write(item, current);
  notify();
  return { saved: patchOf({ item, current }), written };
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
export function removePatch(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  const item = { ...entry.item, hiddenAt: Date.now() };
  entries.set(id, { ...entry, item });
  void write(item).catch(() => {});
  notify();
}

/** Subscribe to library changes (save/remove). Returns an unsubscribe fn. */
export function subscribePatches(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A fresh patch id. */
export function newPatchId(): string {
  return `pt-${randomUuid().slice(0, 8)}`;
}

/** The patches kept in localStorage before the library, oldest first; none when there's no storage. */
function oldPatches(): Patch[] {
  try {
    const list = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) ?? "[]") as Patch[];
    return Array.isArray(list) ? [...list].reverse() : [];
  } catch {
    return [];
  }
}

/**
 * Load the library from `chosen` and use it from now on. The first time, patches kept in
 * localStorage before the library move in, each as its first version, and the old key goes once
 * they're all stored.
 */
export async function openLibrary(chosen: LibraryBackend): Promise<void> {
  backend = chosen;
  const { items, current } = await chosen.load();
  const currentOf = new Map(current.map((version) => [version.itemId, version]));
  entries.clear();
  items.forEach((item) => {
    const version = currentOf.get(item.id);
    if (version) entries.set(item.id, { item, current: version });
  });
  notify();
  const old = oldPatches();
  if (!old.length) return;
  try {
    const moving = old.filter((patch) => !entries.has(patch.id));
    await Promise.all(moving.map((patch) => stored(patch, patch.createdAt).written));
    localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // A write failed: the old key stays, so the next open tries again and nothing is lost.
  }
}
