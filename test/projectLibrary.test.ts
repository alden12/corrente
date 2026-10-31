import { beforeEach, describe, expect, it } from "vitest";
import { MemoryProjectStorage, setProjectStorage } from "../src/audio/bundleStore";
import { currentProjectId, getRepository, setCurrentProject } from "../src/audio/projectRepository";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { VersionStore } from "../src/audio/commands/history";
import { attachAutosave } from "../src/audio/persistence";
import {
  listProjects,
  newProjectId,
  patchProjectName,
  refreshProjects,
  subscribeProjects,
} from "../src/audio/projects/library";
import {
  initProjects,
  createProject,
  switchProject,
  renameProject,
  deleteProject,
  forkProjectFromSnapshot,
  importProject,
  readProjectBundle,
  planImport,
  applyImport,
} from "../src/audio/projects/operations";
import { PROJECT_SCHEMA } from "../src/audio/project/documentMigration";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh set of live objects sharing one repository (via the swapped global storage). */
function deps() {
  const projectStore = new ProjectStore();
  const editLog = new EditLog(projectStore);
  const versionStore = new VersionStore(projectStore, editLog);
  return { projectStore, editLog, versionStore };
}

describe("project library operations", () => {
  beforeEach(() => {
    setProjectStorage(new MemoryProjectStorage()); // isolated per test; repo + ops share it
  });

  it("init on an empty store seeds one project and makes it current", async () => {
    const d = deps();
    await initProjects(d);
    expect(listProjects()).toHaveLength(1);
    expect(currentProjectId()).toBe(listProjects()[0].id);
  });

  // DAW-98: the log took its rebuild base when it was made, before the starter song went in, so
  // undoing the first edit rebuilt the project with the starter track alone.
  it("undoing the first project's first edit keeps the starter song", async () => {
    const d = deps();
    await initProjects(d, { exampleSong: true });
    const seeded = d.projectStore.getTracks().map((track) => track.id);
    expect(seeded.length).toBeGreaterThan(1);

    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-extra" });
    d.editLog.undo();

    expect(d.projectStore.getTracks().map((track) => track.id)).toEqual(seeded);
  });

  it("create switches to a new project; switching back restores each project's tracks", async () => {
    const d = deps();
    await initProjects(d);
    const first = currentProjectId();

    // Give the first project a distinctive second track.
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-first" });
    const firstCount = d.projectStore.getTracks().length;

    const second = await createProject(d, "Sketch 2");
    expect(second).not.toBe(first);
    expect(listProjects().map((meta) => meta.name)).toContain("Sketch 2");
    // The new project is a fresh default (does not have the first project's extra track).
    expect(d.projectStore.getTracks().some((track) => track.id === "t-first")).toBe(false);

    await switchProject(d, first);
    expect(currentProjectId()).toBe(first);
    expect(d.projectStore.getTracks()).toHaveLength(firstCount);
    expect(d.projectStore.getTracks().some((track) => track.id === "t-first")).toBe(true);
  });

  it("autosave follows the current project across a switch (no cross-project bleed)", async () => {
    // Reproduces the switch bug: attachAutosave must resolve the *current* repository
    // at save time, not capture the one bound at attach. With a captured repo, edits to
    // the second project were written into the first project's bundle, so switching back
    // showed the wrong project's tracks. The 300ms debounce means we wait past it.
    const d = deps();
    await initProjects(d);
    const dispose = attachAutosave(d.projectStore, d.editLog); // no repo -> follows getRepository()
    const first = currentProjectId();

    const second = await createProject(d, "Second");
    // Edit the second project and let autosave persist it into *its* bundle.
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-second" });
    await tick(400);

    await switchProject(d, first);
    // The first project must be untouched by the second project's autosaves.
    expect(d.projectStore.getTracks().some((track) => track.id === "t-second")).toBe(false);

    await switchProject(d, second);
    // The second project's edit persisted to its own bundle and comes back on return.
    expect(d.projectStore.getTracks().some((track) => track.id === "t-second")).toBe(true);
    dispose();
  });

  it("rename updates the library list", async () => {
    const d = deps();
    await initProjects(d);
    const id = currentProjectId();
    await renameProject(id, "My Beat");
    expect(listProjects().find((meta) => meta.id === id)?.name).toBe("My Beat");
  });

  it("forks a copy from a snapshot without switching the current project", async () => {
    const d = deps();
    await initProjects(d);
    const original = currentProjectId();

    // A snapshot carrying an edit the original bundle doesn't have (the "my offline state").
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-mine" });
    const myState = d.projectStore.snapshot();
    // Rewind the live store so the original bundle is WITHOUT that track (simulating "take theirs" locally).
    d.editLog.undo();

    const copyId = await forkProjectFromSnapshot(myState, "My Track (copy)");
    expect(copyId).not.toBe(original);
    expect(currentProjectId()).toBe(original); // fork does NOT switch the current project
    expect(listProjects().find((meta) => meta.id === copyId)?.name).toBe("My Track (copy)");

    // Opening the copy shows the forked state (the edit that was only in the snapshot).
    await switchProject(d, copyId);
    expect(d.projectStore.getTracks().some((track) => track.id === "t-mine")).toBe(true);
  });

  it("an export of any project imports as a new project, leaving the original as it was", async () => {
    const d = deps();
    await initProjects(d);
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-exported" });
    d.editLog.dispatch({ type: "renameProject", name: "Groove" });
    await renameProject(currentProjectId(), "Groove");
    const original = currentProjectId();
    // Exported from storage while another project is open, the way a row's Export reads it.
    await createProject(d, "Elsewhere");
    const files = await readProjectBundle(original);

    const copy = await importProject(d, files);
    expect(copy).not.toBe(original); // its own id, not the exported project's
    expect(currentProjectId()).toBe(copy);
    expect(d.projectStore.getTracks().some((track) => track.id === "t-exported")).toBe(true);
    expect(listProjects().map((meta) => meta.name)).toEqual(expect.arrayContaining(["Groove", "Elsewhere"]));
    expect(listProjects()).toHaveLength(3);
  });

  it("deleting the current project falls back to another", async () => {
    const d = deps();
    await initProjects(d);
    const first = currentProjectId();
    const second = await createProject(d, "Second");
    expect(listProjects()).toHaveLength(2);

    await deleteProject(d, second);
    expect(listProjects().map((meta) => meta.id)).not.toContain(second);
    expect(currentProjectId()).toBe(first);
    expect(listProjects()).toHaveLength(1);
  });
});

describe("opening an export that is a version of a project (HOST-23.2.1.2)", () => {
  /** Another device: its own storage, and its own first project (not the one last open here). */
  const storage = () => {
    setProjectStorage(new MemoryProjectStorage());
    setCurrentProject(newProjectId());
  };
  const hasTrack = (d: ReturnType<typeof deps>, id: string) =>
    d.projectStore.getTracks().some((track) => track.id === id);
  /** The open project exported as the app does: from the live log, which may not be saved yet. */
  const exportNow = (d: ReturnType<typeof deps>) =>
    getRepository().exportBundle(d.projectStore.snapshot(), d.editLog.getEntries(), d.editLog.getNotes());
  /** A fresh device with one project, given one edit. */
  async function twoVersions() {
    storage();
    const d = deps();
    await initProjects(d);
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-one" });
    return { d, id: currentProjectId() };
  }

  it("restores a project that isn't here under its own id, as after losing the device", async () => {
    const { d, id } = await twoVersions();
    const files = await exportNow(d);

    storage(); // a new device
    const fresh = deps();
    await initProjects(fresh);
    const plan = await planImport(fresh, files, undefined, true);
    expect(plan.relation).toBe("absent");
    expect(plan.actions).toEqual(["restore"]);
    expect(await applyImport(fresh, plan, "restore")).toBe(id);
    expect(currentProjectId()).toBe(id);
    expect(hasTrack(fresh, "t-one")).toBe(true);
  });

  it("offers to open the same version, or copy it", async () => {
    const { d } = await twoVersions();
    const plan = await planImport(d, await exportNow(d), undefined, true);
    expect(plan.relation).toBe("same");
    expect(plan.actions).toEqual(["open", "copy"]);
  });

  it("rolls back to an earlier version as an edit, which undo takes back", async () => {
    const { d, id } = await twoVersions();
    const v1 = await exportNow(d);
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-two" });

    const plan = await planImport(d, v1, undefined, true);
    expect(plan.relation).toBe("earlier");
    expect(plan.actions).toEqual(["rollback", "copy"]);
    await applyImport(d, plan, "rollback");
    expect(currentProjectId()).toBe(id);
    expect(hasTrack(d, "t-two")).toBe(false);
    expect(hasTrack(d, "t-one")).toBe(true);
    d.editLog.undo();
    expect(hasTrack(d, "t-two")).toBe(true);
  });

  it("brings a project up to a newer version of it", async () => {
    const { d, id } = await twoVersions();
    const v1 = await exportNow(d);
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-two" });
    const v2 = await exportNow(d);

    storage(); // somewhere with only the first version
    const there = deps();
    await initProjects(there);
    await applyImport(there, await planImport(there, v1, undefined, true), "restore");
    const plan = await planImport(there, v2, undefined, true);
    expect(plan.relation).toBe("newer");
    expect(plan.actions).toEqual(["update", "copy"]);
    await applyImport(there, plan, "update");
    expect(currentProjectId()).toBe(id);
    expect(hasTrack(there, "t-two")).toBe(true);
  });

  it("only copies a version that went another way, and names the copy", async () => {
    const { d, id } = await twoVersions();
    const v1 = await exportNow(d);
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-here" });
    const ours = await exportNow(d);

    storage();
    const there = deps();
    await initProjects(there);
    await applyImport(there, await planImport(there, v1, undefined, true), "restore");
    there.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-there" });
    const theirs = await exportNow(there);

    storage();
    const third = deps();
    await initProjects(third);
    await applyImport(third, await planImport(third, ours, undefined, true), "restore");
    const plan = await planImport(third, theirs, undefined, true);
    expect(plan.relation).toBe("diverged");
    expect(plan.actions).toEqual(["copy"]);
    const copy = await applyImport(third, plan, "copy");
    expect(copy).not.toBe(id);
    expect(listProjects().find((meta) => meta.id === copy)?.name).toMatch(/\(copy\)$/);
  });

  it("always makes a new project where ids aren't this device's own (hosted)", async () => {
    const { d } = await twoVersions();
    const plan = await planImport(d, await exportNow(d), undefined, false);
    expect(plan.actions).toEqual(["copy"]);
    expect(plan.projectId).toBeUndefined();
  });

  it("refuses a file from a newer version of the app", async () => {
    const { d } = await twoVersions();
    const files = await exportNow(d);
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    files["manifest.json"] = new TextEncoder().encode(
      JSON.stringify({ ...manifest, projectSchema: PROJECT_SCHEMA + 1 }),
    );
    await expect(planImport(d, files, undefined, true)).rejects.toThrow(/newer version of Corrente/);
  });
});

describe("MemoryProjectStorage enumerate + delete", () => {
  it("lists written project ids and deletes a project's bytes", async () => {
    const storage = new MemoryProjectStorage();
    await storage.bundle("a").writeText("project.json", "{}");
    await storage.bundle("b").writeText("meta.json", '{"name":"B"}');
    const ids = async () => (await storage.listProjects()).map((project) => project.id);
    expect((await ids()).sort()).toEqual(["a", "b"]);
    // meta.json feeds the listing name; a bundle without one falls back to its id.
    expect((await storage.listProjects()).find((project) => project.id === "b")?.name).toBe("B");

    await storage.deleteProject("a");
    expect(await ids()).toEqual(["b"]);
    expect(await storage.bundle("a").readText("project.json")).toBeNull();
  });
});

describe("patchProjectName (live rename propagation)", () => {
  it("updates the cached label in place and notifies subscribers", async () => {
    const storage = new MemoryProjectStorage();
    setProjectStorage(storage);
    await storage.bundle("p1").writeText("meta.json", JSON.stringify({ name: "Old" }));
    await refreshProjects(storage);
    expect(listProjects().find((meta) => meta.id === "p1")?.name).toBe("Old");

    let notified = 0;
    const unsub = subscribeProjects(() => (notified += 1));
    patchProjectName("p1", "New");
    expect(listProjects().find((meta) => meta.id === "p1")?.name).toBe("New");
    expect(notified).toBe(1);

    patchProjectName("missing", "x"); // no-op: not in the cache, no notification
    expect(notified).toBe(1);
    unsub();
  });
});
