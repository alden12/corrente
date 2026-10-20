import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { applyEdit } from "../src/audio/commands/applyEdit";
import { describeCommand } from "../src/audio/commands/describe";
import type { EditCommand } from "../src/audio/commands/types";
import "fake-indexeddb/auto";
import {
  libraryWritten,
  listPatches,
  newPatchId,
  openLibrary,
  removePatch,
  savePatch,
} from "../src/audio/patches/library";
import { memoryBackend, type LibraryBackend, type LibraryOutbox } from "../src/audio/library/backend";
import { indexedDbBackend } from "../src/audio/library/indexedDb";

/** A localStorage for the move-in, which the node test env doesn't have. */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

const samplePatch = (over: Partial<Parameters<typeof savePatch>[0]> = {}) => ({
  id: newPatchId(),
  name: "Warm Pad",
  author: "you" as const,
  instrumentType: "subtractive",
  params: { "filter.cutoff": 1200 },
  effects: [{ type: "delay", bypassed: false, params: { mix: 0.4 } }],
  createdAt: 1,
  ...over,
});

/** A fresh device: its own IndexedDB database. */
const freshDevice = async (): Promise<LibraryBackend & LibraryOutbox> => {
  indexedDB.deleteDatabase("corrente-library");
  return (await indexedDbBackend())!;
};

describe("the patch library (COMM-1.11.1)", () => {
  beforeEach(async () => openLibrary(memoryBackend()));
  afterEach(() => delete (globalThis as { localStorage?: Storage }).localStorage);

  it("saves, lists newest first, and hides what's deleted", () => {
    expect(listPatches()).toEqual([]);
    const a = samplePatch({ name: "A" });
    const b = samplePatch({ name: "B" });
    savePatch(a, 1);
    savePatch(b, 2);
    expect(listPatches().map((p) => p.name)).toEqual(["B", "A"]);

    removePatch(a.id);
    expect(listPatches().map((p) => p.name)).toEqual(["B"]);
  });

  it("saves over a patch as its next version, with that version's tags and description", () => {
    const p = samplePatch({ name: "One", tags: ["pad"], description: "for the verse" });
    expect(savePatch(p).version).toBe(1);
    const again = savePatch({ ...p, name: "Renamed", tags: ["pad", "dark"], description: undefined });
    expect(again.version).toBe(2);
    expect(listPatches()).toHaveLength(1);
    expect(listPatches()[0]).toMatchObject({ name: "Renamed", tags: ["pad", "dark"], version: 2 });
    expect(listPatches()[0].description).toBeUndefined();
  });

  it("keeps patches on the device, each version queued for the account in order", async () => {
    const device = await freshDevice();
    await openLibrary(device);
    const p = samplePatch({ tags: ["keys"] });
    savePatch(p);
    savePatch({ ...p, params: { "filter.cutoff": 400 } });
    await libraryWritten();

    await openLibrary(memoryBackend());
    expect(listPatches()).toEqual([]);
    await openLibrary(device);
    expect(listPatches()).toMatchObject([{ id: p.id, version: 2, params: { "filter.cutoff": 400 }, tags: ["keys"] }]);
    // Not on an account yet: both versions wait, oldest first.
    expect((await device.queued(10)).map((save) => save.version?.version)).toEqual([1, 2]);
  });

  it("moves patches kept in localStorage in, once they're stored", async () => {
    const storage = installLocalStorage();
    const old = [samplePatch({ name: "Newer", createdAt: 2 }), samplePatch({ name: "Older", createdAt: 1 })];
    storage.set("corrente:patches:v1", JSON.stringify(old));
    const device = await freshDevice();
    await openLibrary(device);
    expect(listPatches().map((p) => p.name)).toEqual(["Newer", "Older"]);
    expect(storage.has("corrente:patches:v1")).toBe(false);

    await openLibrary(device);
    expect(listPatches()).toHaveLength(2);
  });

  it("moves the old patches that read, and keeps the key while any doesn't", async () => {
    const storage = installLocalStorage();
    storage.set("corrente:patches:v1", JSON.stringify([samplePatch({ name: "Fine" }), { name: "no id or sound" }]));
    await openLibrary(await freshDevice());
    expect(listPatches().map((p) => p.name)).toEqual(["Fine"]);
    expect(storage.has("corrente:patches:v1")).toBe(true);
  });

  it("leaves the old patches where they were when storing them fails", async () => {
    const storage = installLocalStorage();
    storage.set("corrente:patches:v1", JSON.stringify([samplePatch()]));
    const failing: LibraryBackend = {
      load: async () => ({ items: [], current: [] }),
      save: () => Promise.reject(new Error("full")),
    };
    await openLibrary(failing);
    expect(storage.has("corrente:patches:v1")).toBe(true);
  });
});

/** A createTrackFromPatch edit with fixed ids, so two applies are comparable. */
function patchCommand(): Extract<EditCommand, { type: "createTrackFromPatch" }> {
  return {
    type: "createTrackFromPatch",
    id: "t-patch",
    name: "Warm Pad",
    instrumentType: "subtractive",
    params: { "filter.cutoff": 1234 },
    effects: [
      { id: "fx-1", type: "delay", bypassed: false, params: { mix: 0.4 } },
      { id: "fx-2", type: "reverb", bypassed: true, params: {} },
    ],
  };
}

describe("addTrackFromPatch (apply a patch as one edit)", () => {
  it("builds the instrument track with its params and effect chain", () => {
    const project = new ProjectStore(false);
    applyEdit(project, patchCommand(), "you");

    const track = project.getTrack("t-patch");
    expect(track?.kind).toBe("instrument");
    expect(track?.name).toBe("Warm Pad");
    expect((track as { instrumentType: string }).instrumentType).toBe("subtractive");
    // Instrument param loaded from the patch.
    expect((track as { params: { get(id: string): unknown } }).params.get("filter.cutoff")).toBe(1234);

    // Effects added in order, with their ids, params, and bypass state.
    expect(project.getEffect("t-patch", "fx-1")?.type).toBe("delay");
    expect(project.getEffect("t-patch", "fx-1")?.params.get("mix")).toBe(0.4);
    expect(project.getEffect("t-patch", "fx-2")?.type).toBe("reverb");
    expect(project.getEffect("t-patch", "fx-2")?.bypassed).toBe(true);
  });

  it("is a pure function of the command: two fresh stores produce identical state (replayable)", () => {
    const a = new ProjectStore(false);
    const b = new ProjectStore(false);
    applyEdit(a, patchCommand(), "you");
    applyEdit(b, patchCommand(), "you");
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("is idempotent by track id (re-applying the same command does not duplicate)", () => {
    const project = new ProjectStore(false);
    applyEdit(project, patchCommand(), "you");
    const once = project.snapshot();
    applyEdit(project, patchCommand(), "you"); // same id -> no-op
    expect(project.snapshot()).toEqual(once);
  });

  it("describes nicely in the activity feed", () => {
    expect(describeCommand(patchCommand())).toBe('Added "Warm Pad" from the library');
  });
});
