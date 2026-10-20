/**
 * The library's queue for the account (COMM-1.11.2): saves wait on the device until the account
 * confirms them, what comes back is kept as the account numbered it, a refused save is set aside
 * rather than block the rest, and a signed-out library moves into an account.
 */
import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { listPatches, newPatchId, openLibrary, savePatch } from "../src/audio/patches/library";
import type { LibraryEntry, LibraryOutbox, LibraryBackend } from "../src/audio/library/backend";
import { indexedDbBackend } from "../src/audio/library/indexedDb";
import { drainLibrary, type LibrarySyncRequest, type SendLibrary } from "../src/audio/library/sync";
import type { LibrarySave } from "../src/audio/library/schema";

type Library = LibraryBackend & LibraryOutbox;

let databases = 0;
const freshLibrary = async (): Promise<Library> => (await indexedDbBackend(`library-sync-${++databases}`))!;

const patch = (cutoff: number, over: { id?: string; name?: string } = {}) => ({
  id: over.id ?? newPatchId(),
  name: over.name ?? "Pad",
  author: "you" as const,
  instrumentType: "subtractive",
  params: { "filter.cutoff": cutoff },
  effects: [],
  createdAt: 1,
});

/**
 * An account in memory, numbering versions as the server does: every version save is the item's
 * next, whatever number the device gave it. Refuses a request holding a save `refuse` picks out.
 */
function fakeAccount(refuse: (save: LibrarySave) => boolean = () => false) {
  const entries = new Map<string, LibraryEntry>();
  let clock = 0;
  const requests: LibrarySyncRequest[] = [];
  const send: SendLibrary = async (request) => {
    requests.push(request);
    if (request.saves.some(refuse)) return { refused: "400: not that one" };
    request.saves.forEach((save) => {
      const existing = entries.get(save.item.id);
      if (!existing && !save.version) return;
      const version = save.version ? (existing?.item.version ?? 0) + 1 : existing!.item.version;
      entries.set(save.item.id, {
        item: { ...save.item, version, updatedAt: ++clock },
        current: save.version
          ? { ...save.version, itemId: save.item.id, version, hash: `hash-${save.item.id}-${version}` }
          : existing!.current,
      });
    });
    const since = Number(request.since ?? 0);
    return {
      cursor: String(clock),
      entries: [...entries.values()].filter((entry) => entry.item.updatedAt > since),
    };
  };
  return { entries, requests, send };
}

const always = () => true;

describe("the library's queue for the account", () => {
  let library: Library;
  beforeEach(async () => {
    library = await freshLibrary();
    await openLibrary(library);
  });

  it("keeps what the account sent back, numbered its way, and empties the queue", async () => {
    const account = fakeAccount();
    const saved = patch(800);
    // Another device saved this patch first, so the account calls this device's save version 2.
    await account.send({
      saves: [
        {
          item: { id: saved.id, kind: "patch", name: "Pad", createdAt: 1 },
          version: { version: 1, createdAt: 1, author: "you", tags: [], document: {} },
        },
      ],
    });
    await savePatch(saved);
    await drainLibrary(library, library, account.send, always);

    expect(listPatches()).toMatchObject([{ id: saved.id, version: 2, params: { "filter.cutoff": 800 } }]);
    expect(await library.queued(10)).toEqual([]);
    expect(await library.cursor()).toBe("2");
    // Stored as confirmed, so a reload reads the account's version.
    await openLibrary(await freshLibrary());
    await openLibrary(library);
    expect(listPatches()).toMatchObject([{ version: 2 }]);
  });

  it("keeps a save made while a sync is out, and sends it next time", async () => {
    const account = fakeAccount();
    const saved = patch(800);
    await savePatch(saved);
    let answer: () => void = () => {};
    let sent: () => void = () => {};
    const out = new Promise<void>((resolve) => (sent = resolve));
    const slow: SendLibrary = async (request) => {
      sent();
      await new Promise<void>((resolve) => (answer = resolve));
      return account.send(request);
    };
    const syncing = drainLibrary(library, library, slow, always);
    await out;
    await savePatch({ ...saved, params: { "filter.cutoff": 300 } });
    answer();
    await syncing;

    expect(listPatches()).toMatchObject([{ params: { "filter.cutoff": 300 } }]);
    expect((await library.queued(10)).map((save) => save.version?.document)).toMatchObject([
      { params: { "filter.cutoff": 300 } },
    ]);
    await drainLibrary(library, library, account.send, always);
    expect(listPatches()).toMatchObject([{ version: 2, params: { "filter.cutoff": 300 } }]);
  });

  it("sets aside a save the account refuses, and sends the rest", async () => {
    const account = fakeAccount((save) => save.item.name === "Broken");
    await savePatch(patch(1, { name: "Fine" }));
    await savePatch(patch(2, { name: "Broken" }));
    await savePatch(patch(3, { name: "Also fine" }));
    expect(await drainLibrary(library, library, account.send, always)).toBe(1);

    expect([...account.entries.values()].map((entry) => entry.item.name).sort()).toEqual(["Also fine", "Fine"]);
    expect(await library.queued(10)).toEqual([]);
    // Still on this device.
    expect(listPatches().map((saved) => saved.name)).toContain("Broken");
    await drainLibrary(library, library, account.send, always);
    expect(account.requests.at(-1)?.saves).toEqual([]);
  });

  it("leaves an answer alone once the account it was for isn't signed in", async () => {
    const account = fakeAccount();
    await savePatch(patch(800));
    await drainLibrary(library, library, account.send, () => false);
    expect(await library.queued(10)).toHaveLength(1);
  });

  it("moves a signed-out library into an account", async () => {
    const signedOut = library;
    const kept = patch(800, { name: "Made signed out" });
    await savePatch(kept);
    const accountLibrary = await freshLibrary();
    await openLibrary(accountLibrary);
    const account = fakeAccount();

    expect(await drainLibrary(signedOut, accountLibrary, account.send, always)).toBe(0);
    expect(listPatches()).toMatchObject([{ id: kept.id, name: "Made signed out", version: 1 }]);
    expect(await signedOut.queued(10)).toEqual([]);
    // Kept in the account's library, not queued there: the account has it.
    expect(await accountLibrary.queued(10)).toEqual([]);
    await openLibrary(signedOut);
    await openLibrary(accountLibrary);
    expect(listPatches()).toHaveLength(1);
  });
});

describe("the library's database, version 1 to 2", () => {
  it("queues the versions a signed-out device kept, since no account has them", async () => {
    const name = "library-upgrade";
    const old = await openDB(name, 1, {
      upgrade(upgrading) {
        upgrading.createObjectStore("items", { keyPath: "id" });
        upgrading.createObjectStore("versions", { keyPath: ["itemId", "version"] }).createIndex("tags", "tags", {
          multiEntry: true,
        });
      },
    });
    await old.put("items", { id: "pt-old", kind: "patch", name: "Old", version: 2, createdAt: 1, updatedAt: 3 });
    await old.add("versions", {
      itemId: "pt-old",
      version: 2,
      createdAt: 3,
      author: "you",
      tags: [],
      document: { at: 2 },
    });
    await old.add("versions", {
      itemId: "pt-old",
      version: 1,
      createdAt: 1,
      author: "you",
      tags: [],
      document: { at: 1 },
    });
    old.close();

    const upgraded = (await indexedDbBackend(name))!;
    expect((await upgraded.queued(10)).map((save) => save.version?.version)).toEqual([1, 2]);
    expect((await upgraded.load()).current).toMatchObject([{ version: 2, document: { at: 2 } }]);
  });
});
