/**
 * Which groups are folded, remembered on this device per project (DAW-49), and the one fold the
 * project tree and the arrangement share (DAW-83): both read `group.collapsed` and fold through
 * `setGroupCollapsed`, and this keeps that value across a reload, a project switch and an undo.
 *
 * A fold is how you are looking at the project, not a change to it, so it lives in this browser
 * rather than in the document or history. A load (opening the project, or the rebuild an undo
 * does) puts back whatever the snapshot held, so after every change the store is brought back to
 * what this device remembers; a fold by hand (`subscribeFolds`) is what updates the memory.
 * A project this device has never remembered keeps the folds it opened with.
 */
import type { ProjectStore } from "../audio/project/projectStore";
import { currentProjectId, loadedProjectId, subscribeCurrentProject } from "../audio/projectRepository";
import { readPersistent, writePersistent } from "./persistentStore";

const key = (projectId: string) => `corrente:group-folds:${projectId}`;

function readFolds(projectId: string): Set<string> | null {
  const raw = readPersistent(key(projectId));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return null;
  }
}

/**
 * The project the store holds, or null mid-switch: from repointing at the next project until its
 * load is marked, the store's groups may be either project's, and the main group's id is the same
 * in every project, so a fold read or saved then could land on the wrong one.
 */
function settledProjectId(): string | null {
  const loaded = loadedProjectId();
  return loaded !== null && loaded === currentProjectId() ? loaded : null;
}

/** Keep `projectStore`'s folds remembered on this device. Returns the function that stops it. */
export function rememberGroupFolds(projectStore: ProjectStore): () => void {
  // Set while the store is being brought to the remembered folds, whose own fold events would
  // otherwise save a half-restored set over the memory.
  let restoring = false;

  const save = () => {
    const projectId = settledProjectId();
    if (restoring || projectId === null) return;
    // Written from the groups there are, so a deleted group's id goes with it.
    const folded = projectStore
      .getGroups()
      .filter((group) => group.collapsed)
      .map((group) => group.id);
    writePersistent(key(projectId), JSON.stringify(folded));
  };

  const restore = () => {
    const projectId = settledProjectId();
    if (restoring || projectId === null) return;
    const remembered = readFolds(projectId);
    if (remembered === null) return save();
    restoring = true;
    try {
      projectStore
        .getGroups()
        .filter((group) => group.collapsed !== remembered.has(group.id))
        .forEach((group) => projectStore.setGroupCollapsed(group.id, remembered.has(group.id)));
    } finally {
      restoring = false;
    }
  };

  const stops = [
    projectStore.subscribeFolds(save),
    projectStore.subscribe(restore),
    // The store holds the next project once its load is marked, which is when to restore it.
    subscribeCurrentProject(restore),
  ];
  restore();
  return () => stops.forEach((stop) => stop());
}
