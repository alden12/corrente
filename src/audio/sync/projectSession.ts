/**
 * The hosted app's live connection to the open project (HOST-24): one `SharedSession` per open
 * project, closed the moment the app moves to another and opened afresh once that one has loaded.
 *
 * Its own module because getting this wrong is how edits reach the wrong project. It used to be
 * built inline in `AppShell`, once at boot and never replaced, so after a switch the session still
 * named the first project: edits, renames and reconnect catch-ups all went to (or came from) the
 * wrong one. `followOpenProject` owns *when* a session opens and closes; this file owns *what* a
 * session is wired to. `AppShell` only hears about it through `ProjectSessionEvents`.
 *
 * No React: the UI's state is reached only through the events it passes in.
 */
import type { ProjectStore } from "../project/projectStore";
import type { EditLog } from "../commands/editLog";
import type { EditCommand } from "../commands/types";
import type { VersionStore } from "../commands/history";
import type { ProjectData } from "../project/types";
import { getLocalCacheBundle } from "../bundleStore";
import { getRepository } from "../projectRepository";
import { patchProjectName } from "../projects/library";
import { createWsClient, wsBaseFromApiUrl, type WsStatus } from "../../contract/client";
import { getAccessToken } from "../../auth/session";
import { SharedSession } from "./sharedSession";
import { followOpenProject } from "./followProject";
import { bundleLocalMirror } from "./localMirror";
import type { ConflictInfo } from "./conflict";

export interface ProjectSessionDeps {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
  /** The sync API's base URL (`VITE_DAW_API_URL`). */
  apiUrl: string;
}

/** What the UI hears from the live session. */
export interface ProjectSessionEvents {
  /** The socket's state, for the status chip. */
  onStatus: (status: WsStatus) => void;
  /** A session opened for a newly loaded project, or (null) the last one closed. */
  onSession: (session: SharedSession | null) => void;
  /** A collaborator's edit arrived: the project is shared, so going offline is worth a warning. */
  onPeerEdit: (command: EditCommand) => void;
  /** A reconnect found our offline edits clashing with a peer's, for the conflict dialog. */
  onConflict: (info: ConflictInfo, myState: ProjectData) => void;
}

/** Keep a session open for whichever project is open, until the returned stop is called. */
export function followProjectSessions(deps: ProjectSessionDeps, events: ProjectSessionEvents): () => void {
  return followOpenProject((projectId) => openProjectSession(projectId, deps, events));
}

/**
 * Open the live session for `projectId`, which the store has just loaded, and return its close.
 * Everything here is scoped to that one project; nothing may read "the current project" instead,
 * since by the time a callback runs the app may have moved on.
 */
export function openProjectSession(
  projectId: string,
  { projectStore, editLog, versionStore, apiUrl }: ProjectSessionDeps,
  events: ProjectSessionEvents,
): () => void {
  // The log just loaded is this project's, so its highest seq is where the session starts from.
  const entries = editLog.getEntries();
  const notes = editLog.getNotes();
  const baseSeq = Math.max(-1, ...entries.map((entry) => entry.seq), ...notes.map((note) => note.seq));
  const transport = createWsClient({
    baseUrl: wsBaseFromApiUrl(apiUrl),
    token: getAccessToken, // the live session token (getter), so a reconnect uses a refreshed one
  });
  transport.onStatus(events.onStatus);
  // Durable OPFS mirror (cache-only) so offline edits survive a reload and the confirmed stream
  // replays offline. Null when OPFS is unavailable (remote-only, no offline durability).
  const cacheBundle = getLocalCacheBundle(projectId);
  const session = new SharedSession({
    projectStore,
    editLog,
    transport,
    projectId,
    baseSeq,
    localMirror: cacheBundle ? bundleLocalMirror(cacheBundle) : undefined,
    onError: (message) => console.warn(`[corrente] sync: ${message}`),
    // On a rename, update our library-list label straight from the edit (the store already applied
    // it), so the list reflects it live without a reload. This session's project, never whichever
    // is current by then.
    onRemoteEdit: (command) => {
      events.onPeerEdit(command);
      if (command.type === "renameProject") patchProjectName(projectId, command.name);
    },
    // The session is holding our offline edits and showing the peer's state; the dialog resolves it
    // via `discardPending` (take theirs) or a fork (keep mine).
    onConflict: events.onConflict,
    // The authoritative log advanced: refresh server-side version history from its markers.
    onConfirmed: () => void versionStore.onLogAdvanced(),
    // How the session recovers from a tombstone it cannot honour itself - one taking back an edit
    // already folded into its seed (DAW-41). The authority rebuilt without that edit and wrote
    // `project.json`, so re-reading it is the answer. Remote-first through the cached store, so this
    // gets the fresh file whenever there is a network.
    readAuthoritativeHead: () => getRepository().readHeadKeyframe(),
  });
  session.attach();
  // Pull the retained keyframe ring into the offline cache while there IS a network (DAW-34 stage
  // E). Reads are read-through, so without this the cache holds whichever ring slots an undo
  // happened to need online, and offline undo depth comes down to what you did first.
  // Fire-and-forget and skips what the cache already holds, so a reload costs nothing.
  void getRepository()
    .warmRebuildBases(baseSeq, cacheBundle)
    .catch(() => {});
  // Server-authoritative history: author commits/reverts through the session and derive the version
  // list from the log (not the client file-DAG), so the client-side auto-checkpoint no-ops.
  versionStore.setRemote(session);
  events.onSession(session);

  return () => {
    versionStore.setRemote(null);
    session.close();
    events.onSession(null);
  };
}
