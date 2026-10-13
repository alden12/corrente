/**
 * One live session per open project, and only ever for the project on screen (HOST-24).
 *
 * The sync session used to be opened once at boot, for whichever project boot loaded, and never
 * replaced. After a switch the store held the new project while the session still named the old
 * one, so every edit went to the old project's log, a rename renamed the old project on the
 * server, and a reconnect (the phone coming back from the background) re-subscribed to the old
 * project and rebuilt the screen from it.
 *
 * So the session follows the project, on two signals `projectRepository` already gives:
 * - **the current id moves** (`setCurrentProject`, synchronous, before any load starts): close the
 *   session at once, so nothing that happens during the load - an edit, a peer's edit, a
 *   reconnect's catch-up - can reach the store or the server through it;
 * - **the store has loaded that id** (`markProjectLoaded`): open a session for it, which starts
 *   from the log just loaded.
 *
 * Closing keeps a session's unconfirmed edits in that project's local mirror, so they are sent
 * the next time that project is opened, to that project.
 */
import { currentProjectId, loadedProjectId, subscribeCurrentProject } from "../projectRepository";

export interface ProjectSignals {
  currentProjectId: () => string;
  loadedProjectId: () => string | null;
  subscribe: (listener: () => void) => () => void;
}

const REPOSITORY: ProjectSignals = {
  currentProjectId,
  loadedProjectId,
  subscribe: subscribeCurrentProject,
};

/**
 * Keep `open(projectId)` running for the open project: called once a project has loaded, and its
 * returned close called as soon as the app moves to another. Returns a stop that closes the last.
 */
export function followOpenProject(
  open: (projectId: string) => () => void,
  signals: ProjectSignals = REPOSITORY,
): () => void {
  let session: { projectId: string; close: () => void } | null = null;

  const follow = () => {
    const current = signals.currentProjectId();
    if (session && session.projectId !== current) {
      const leaving = session;
      session = null;
      leaving.close();
    }
    if (!session && signals.loadedProjectId() === current) {
      session = { projectId: current, close: open(current) };
    }
  };

  follow();
  const unsubscribe = signals.subscribe(follow);
  return () => {
    unsubscribe();
    session?.close();
    session = null;
  };
}
