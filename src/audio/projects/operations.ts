/**
 * Imperative project-library flows: boot, switch, create, rename, delete. These
 * touch the live objects (ProjectStore, EditLog, VersionStore), so they live apart
 * from the pure library store.
 *
 * A switch is the import-in-place flow: flush the current project, repoint the
 * repository to the target bundle, load it into the live store, and reload version
 * history. Everything else (engine graph, MCP mirror, autosave) re-derives from the
 * `projectStore.load` emit, and the AudioContext is preserved.
 */
import { ProjectStore } from "../project/projectStore";
import { addStarterSong } from "../project/starter";
import type { EditLog } from "../commands/editLog";
import type { VersionStore } from "../commands/history";
import type { ProjectData } from "../project/types";
import {
  getRepository,
  setCurrentProject,
  currentProjectId,
  markProjectLoaded,
  ProjectRepository,
  readExport,
  type BundleFiles,
  type ExportContents,
} from "../projectRepository";
import { getProjectStorage, type ProjectStorage } from "../bundleStore";
import { listProjects, newProjectId, nextProjectName, refreshProjects } from "./library";
import { editKeys, relationOf, type ImportRelation } from "./projectVersions";
import { hosting } from "../../hosting";
import { restoreProject } from "../persistence";
import { clearUndoSession } from "../undoSession";

export interface ProjectDeps {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
}

/** Persist the live project into its bundle now (so a switch never loses recent edits). */
async function flush(deps: ProjectDeps): Promise<void> {
  const repo = getRepository();
  await repo.save(deps.projectStore.snapshot(), deps.editLog.getEntries(), deps.editLog.getNotes());
  // The undo stacks are per-tab session state and not part of the bundle, so a switch has nothing
  // to flush for them: `attachUndoPersistence` has already written this tab's copy (DAW-34 stage E).
}

/** Load the current project's bundle into the live objects (+ reload history). */
async function loadCurrentInto(deps: ProjectDeps): Promise<void> {
  // One restore path, shared with the boot one. It used to be a second copy of the same four calls,
  // which is how a project switch quietly missed the rebuild base undo needs (DAW-34) while boot
  // had it: the two drifted the moment one of them grew a step.
  await restoreProject(deps.projectStore, deps.editLog, getRepository());
  await deps.versionStore.reload();
  // The store now holds this project, so anything pairing the current id with what it reads
  // off the store (the URL, the header) can trust the two agree again.
  markProjectLoaded(currentProjectId());
}

/** Point at a fresh project id, seed a default project into it, and load it. */
async function seedNewProject(deps: ProjectDeps, name: string): Promise<string> {
  const id = newProjectId();
  setCurrentProject(id);
  await getRepository().setName(name);
  const seed = new ProjectStore(); // one default track
  seed.renameProject(name); // carry the name in project.json (state), not only meta.json
  await getRepository().save(seed.snapshot(), [], []);
  await loadCurrentInto(deps);
  return id;
}

/**
 * Boot's options. The other operations here take `storage` as a trailing parameter; boot is the
 * only one with a second thing to say, so it names both rather than growing a positional gap.
 */
type InitProjectsOptions = {
  /** Injectable for tests; defaults to the app-wide storage. */
  storage?: ProjectStorage;
  /**
   * The project a link asked for (`null` when the URL named none). It wins over the persisted
   * current, but **only if it is really there**: opening a link to a project you cannot see
   * (signed out, or never shared with you) must fall back to your own, not seed a local
   * project under someone else's id.
   */
  preferId?: string | null;
  /**
   * Whether a first project gets the example song (DAW-76, DAW-94). Off by default, so tests start empty;
   * the app turns it on.
   */
  exampleSong?: boolean;
};

/**
 * Boot: adopt the current project. If none exist yet, seed one (the already-seeded
 * live store) as the first project; otherwise open the project a link asked for, the
 * persisted current, or the newest.
 */
/** Open the project to start on, seeding the first one when there are none. Resolves to whether it seeded. */
export async function initProjects(
  deps: ProjectDeps,
  { storage = getProjectStorage(), preferId, exampleSong = false }: InitProjectsOptions = {},
): Promise<boolean> {
  const ids = (await storage.listProjects()).map((project) => project.id);
  if (ids.length === 0) {
    // Seed the first project under a *stable* id (the persisted current, or "default"),
    // not a fresh random one: boot can run twice (React StrictMode double-invokes the
    // mount effect in dev), and two random ids would seed two projects. A stable id
    // makes the second pass a harmless re-flush of the same bundle.
    setCurrentProject(currentProjectId());
    const name = nextProjectName([]);
    await getRepository().setName(name);
    deps.projectStore.renameProject(name); // carry the name in project.json too, as seedNewProject does
    // The first project anyone sees plays something on the first Play.
    if (exampleSong) addStarterSong(deps.projectStore);
    // The name and the song went in outside the log, after it took its rebuild base from the store, so
    // undoing a first edit rebuilt from the project before them: the starter track alone (DAW-98).
    deps.editLog.setRebuildBase(deps.projectStore.snapshot(), -1);
    await flush(deps); // persist the live (seeded) project as project one
    // This branch never loads: the live store was already seeded, so it *is* this project.
    // Marking it anyway is what lets the URL sync at all on a fresh install.
    markProjectLoaded(currentProjectId());
    await refreshProjects(storage);
    return true;
  } else {
    // The library before the project: a project that cannot be read throws out of the load, and the
    // recovery dialog offers the rest of the library as the way out (DAW-68).
    await refreshProjects(storage);
    // Open the first candidate that is really there: the project a link asked for, else the
    // persisted current, else the newest. Both of the first two can name something gone (see
    // `preferId`, and a stale `localStorage` pointing at a deleted project), so both are checked.
    const ifPresent = (id: string | null | undefined): string | null => (id && ids.includes(id) ? id : null);
    setCurrentProject(ifPresent(preferId) ?? ifPresent(currentProjectId()) ?? ids[0]);
    await loadCurrentInto(deps);
    return false;
  }
}

/** Switch to another saved project (flushes the current one first). No-op if already current. */
export async function switchProject(
  deps: ProjectDeps,
  id: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<void> {
  if (id === currentProjectId()) return;
  await flush(deps);
  setCurrentProject(id);
  await loadCurrentInto(deps);
  await refreshProjects(storage);
}

/** Create a new empty project and switch to it. Returns its id. */
export async function createProject(
  deps: ProjectDeps,
  name?: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<string> {
  await flush(deps);
  const named = name ?? nextProjectName((await storage.listProjects()).map((project) => project.name));
  const id = await seedNewProject(deps, named);
  await refreshProjects(storage);
  return id;
}

/**
 * Fork a new project seeded from a given snapshot (not the live store). Used by the reconnect
 * conflict flow's "keep mine as a copy": the copy carries this client's optimistic (offline) state,
 * leaving the original to converge on the peer's. The copy starts with a fresh history (the snapshot is
 * its first keyframe) and is owned by the creator, unshared. Does NOT flush or load the live store - the
 * caller reloads into the new id afterwards - so the current project is left untouched.
 */
export async function forkProjectFromSnapshot(
  snapshot: ProjectData,
  name: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<string> {
  const id = newProjectId();
  const seed = new ProjectStore(false);
  seed.load(snapshot);
  seed.renameProject(name); // carry the copy's name in project.json (state), like seedNewProject
  // Write through a standalone repository (not the live singleton) so the bundle gets the canonical
  // manifest + keyframe layout without repointing the current project. Empty history: the snapshot is
  // the copy's first keyframe.
  const repo = new ProjectRepository(storage.bundle(id), id);
  await repo.setName(name);
  await repo.save(seed.snapshot(), [], []);
  await refreshProjects(storage);
  return id;
}

/**
 * Make a new project from an exported bundle (an unzipped `.daw.zip`) and switch to it. Returns its id.
 * Written through a standalone repository, like a fork, so a file that will not read leaves the open
 * project untouched. Import used to load the file over the open project, which a mistaken pick lost.
 */
export async function importProject(
  deps: ProjectDeps,
  files: BundleFiles,
  storage: ProjectStorage = getProjectStorage(),
  name?: string,
): Promise<string> {
  const id = newProjectId();
  const repo = new ProjectRepository(storage.bundle(id), id);
  const { project } = await repo.importBundle(files);
  await repo.setName(name ?? (project.name || repo.getName()));
  await switchProject(deps, id, storage);
  return id;
}

/**
 * What opening an exported project can do (HOST-23.2.1.2), the first being the one to suggest:
 * restore it under its own id, open the copy already here, roll the one here back to it, bring the
 * one here up to it, or make a new project of it.
 */
export type ImportAction = "restore" | "open" | "rollback" | "update" | "copy";

const ACTIONS: Record<ImportRelation, ImportAction[]> = {
  absent: ["restore"],
  same: ["open", "copy"],
  earlier: ["rollback", "copy"],
  newer: ["update", "copy"],
  // Each has edits the other lacks, and two histories aren't merged: only a copy keeps both.
  diverged: ["copy"],
};

/** An exported project read, and how it relates to the project of the same id here. */
export interface ImportPlan {
  relation: ImportRelation;
  /** Its own id, kept by everything but a copy. Undefined when it isn't to be kept. */
  projectId?: string;
  name: string;
  /** What to offer. One choice needs no question. */
  actions: ImportAction[];
  contents: ExportContents;
  files: BundleFiles;
}

/** The edit ids of the project here with this id, or undefined when there isn't one. */
async function localEditKeys(deps: ProjectDeps, id: string, storage: ProjectStorage) {
  if (id === currentProjectId()) return editKeys(deps.editLog.getEntries());
  if (!listProjects().some((meta) => meta.id === id)) return undefined;
  const saved = await new ProjectRepository(storage.bundle(id), id).load();
  return saved ? editKeys(saved.log) : undefined;
}

/**
 * Read an exported project and work out what opening it can do, writing nothing. Ids are kept only
 * where the projects are this device's own (standalone): on a server, a file's id could be anyone's
 * project, so there it is always a new one.
 */
export async function planImport(
  deps: ProjectDeps,
  files: BundleFiles,
  storage: ProjectStorage = getProjectStorage(),
  keepIds: boolean = hosting.mode === "standalone",
): Promise<ImportPlan> {
  const contents = readExport(files);
  const projectId = keepIds ? contents.projectId : undefined;
  const relation = projectId
    ? relationOf(await localEditKeys(deps, projectId, storage), editKeys(contents.log))
    : "absent";
  const name = contents.name || contents.project.name || "Untitled";
  return { relation, projectId, name, actions: projectId ? ACTIONS[relation] : ["copy"], contents, files };
}

/** Write a bundle under its own id. */
async function writeBundle(id: string, plan: ImportPlan, storage: ProjectStorage): Promise<void> {
  const repo = new ProjectRepository(storage.bundle(id), id);
  await repo.importBundle(plan.files);
  await repo.setName(plan.name);
}

/** Do one of a plan's actions, and open the project it leaves. Returns that project's id. */
export async function applyImport(
  deps: ProjectDeps,
  plan: ImportPlan,
  action: ImportAction,
  storage: ProjectStorage = getProjectStorage(),
): Promise<string> {
  const id = plan.projectId;
  if (action === "copy" || !id)
    // Beside one of the same name, a copy says so, as a fork does.
    return importProject(deps, plan.files, storage, plan.relation === "absent" ? undefined : `${plan.name} (copy)`);
  const handlers: Record<Exclude<ImportAction, "copy">, () => Promise<void>> = {
    restore: async () => {
      await writeBundle(id, plan, storage);
      await switchProject(deps, id, storage);
    },
    open: () => switchProject(deps, id, storage),
    // An edit, so it can be undone, and the history up to now stays.
    rollback: async () => {
      await switchProject(deps, id, storage);
      deps.editLog.dispatch({
        type: "loadSnapshot",
        project: plan.contents.project,
        message: "Roll back to an exported version",
      });
    },
    // The one here is an earlier part of the file, so writing the file over it loses nothing.
    update: async () => {
      if (id !== currentProjectId()) {
        await writeBundle(id, plan, storage);
        return switchProject(deps, id, storage);
      }
      await flush(deps);
      await getRepository().importBundle(plan.files);
      await loadCurrentInto(deps);
      await refreshProjects(storage);
    },
  };
  await handlers[action]();
  return id;
}

/** A project as a portable bundle, read from where it is stored (not the live store). */
export async function readProjectBundle(
  id: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<BundleFiles> {
  const repo = new ProjectRepository(storage.bundle(id), id);
  const saved = await repo.load();
  if (!saved) throw new Error(`project ${id} has nothing saved`);
  return repo.exportBundle(saved.project, saved.log, saved.notes);
}

/** Rename a project (the current one via the live repo, else its bundle's meta). */
export async function renameProject(
  id: string,
  name: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<void> {
  if (id === currentProjectId()) {
    await getRepository().setName(name);
  } else {
    await storage.bundle(id).writeText("meta.json", JSON.stringify({ name, modifiedAt: new Date().toISOString() }));
  }
  await refreshProjects(storage);
}

/** Delete a project. If it was current, fall back to another (or a fresh one). */
export async function deleteProject(
  deps: ProjectDeps,
  id: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<void> {
  const wasCurrent = id === currentProjectId();
  await storage.deleteProject(id);
  // The undo stacks are per-tab session state rather than bundle contents, so deleting the bundle
  // does not take them with it. Left behind, they would be inherited by a project that reused the
  // id, and every step would name an entry that no longer exists (DAW-34 stage E).
  clearUndoSession(id);
  if (wasCurrent) {
    // Don't flush (that would resurrect the deleted bundle); repoint directly.
    const remaining = (await storage.listProjects()).map((project) => project.id).filter((other) => other !== id);
    if (remaining[0]) {
      setCurrentProject(remaining[0]);
      await loadCurrentInto(deps);
    } else {
      await seedNewProject(deps, nextProjectName([]));
    }
  }
  await refreshProjects(storage);
}
