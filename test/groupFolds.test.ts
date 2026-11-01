import { beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { markProjectLoaded } from "../src/audio/projectRepository";
import { rememberGroupFolds } from "../src/ui/groupFolds";
import { readPersistent, resetPersistentCache } from "../src/ui/persistentStore";

// localStorage-backed, and the node test env has none, so install a minimal shim.
function installLocalStorage(): void {
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
}

/** Open project `id`, as a switch does: repoint at it, then mark its load (after the store's). */
function open(id: string, store?: ProjectStore, data?: ReturnType<ProjectStore["snapshot"]>): void {
  localStorage.setItem("corrente:current-project", id);
  if (store && data) store.load(data);
  markProjectLoaded(id);
}

const folded = (store: ProjectStore) =>
  store
    .getGroups()
    .filter((group) => group.collapsed)
    .map((group) => group.name);

/** A fold is this device's view of a project, kept across loads (DAW-49). */
describe("rememberGroupFolds", () => {
  beforeEach(() => {
    installLocalStorage();
    resetPersistentCache();
    open("p1");
  });

  it("keeps a fold through a load that would open it again, as an undo's rebuild does", () => {
    const store = new ProjectStore();
    const drums = store.addGroup({ name: "Drums" });
    const unfolded = store.snapshot();
    const stop = rememberGroupFolds(store);

    store.setGroupCollapsed(drums.id, true);
    store.load(unfolded);
    expect(folded(store)).toEqual(["Drums"]);
    stop();
  });

  it("puts a project's folds back when it is opened again, and only that project's", () => {
    const store = new ProjectStore();
    const drums = store.addGroup({ name: "Drums" });
    const saved = store.snapshot();
    const stop = rememberGroupFolds(store);
    store.setGroupCollapsed(drums.id, true);

    // Another project, never seen here, opens as it was saved, the fold not carried over to it.
    open("p2", store, saved);
    expect(folded(store)).toEqual([]);

    open("p1", store, saved);
    expect(folded(store)).toEqual(["Drums"]);
    stop();
  });

  it("forgets a group once it is gone", () => {
    const store = new ProjectStore();
    const drums = store.addGroup({ name: "Drums" });
    const stop = rememberGroupFolds(store);
    store.setGroupCollapsed(drums.id, true);
    store.removeGroup(drums.id);
    store.addGroup({ name: "Keys" });
    const keys = store.getGroups().find((group) => group.name === "Keys")!;
    store.setGroupCollapsed(keys.id, true);
    expect(JSON.parse(readPersistent("corrente:group-folds:p1")!)).toEqual([keys.id]);
    stop();
  });
});
