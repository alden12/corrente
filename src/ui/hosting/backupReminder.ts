/**
 * The backup reminder (HOST-23.2.1.2): which projects have changed since they were last exported,
 * and whether it's time to say so. A standalone run's projects live only in this browser, and an
 * export is the copy that survives it, so the reminder is about exports and nothing else.
 *
 * The rules, agreed 2026-10-21:
 * - **250 changes** to a project since its last export, at most **once every 3 days**;
 * - **at least once a week** while any project has changes since its last export;
 * - **Not now** puts it away until a rule next fires, measured from then;
 * - **Don't ask me again** turns it off, until it's turned back on from the panel.
 *
 * A change is an entry in the project's edit log after the newest one the last export carried, so
 * an undo counts too, and a project never exported counts all of its history. Kept in localStorage
 * through `persistentStore`, so the chip and the Projects note read one value.
 */
import { loadedProjectId, currentProjectId } from "../../audio/projectRepository";
import type { EditLog } from "../../audio/commands/editLog";
import type { EditEntry } from "../../audio/commands/types";
import type { ProjectStore } from "../../audio/project/projectStore";
import { readPersistent, subscribePersistent, writePersistent } from "../persistentStore";

const KEY = "corrente:backup-reminder";
const DAY_MS = 24 * 60 * 60 * 1000;
export const MANY_CHANGES = 250;
const MANY_CHANGES_GAP_MS = 3 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;

export interface ProjectChanges {
  name: string;
  /** The newest log entry the last export carried, or -1 if it's never been exported. */
  exportedSeq: number;
  /** Log entries since then. */
  changes: number;
  /** When the first of them was made, if there are any. */
  since?: number;
}

export interface ReminderState {
  projects: Record<string, ProjectChanges>;
  /** When the reminder was last put away with Not now. */
  dismissedAt?: number;
  /** Don't ask me again. */
  off?: boolean;
}

const EMPTY: ReminderState = { projects: {} };

/** The entries after `exportedSeq`: how many, and when the first was made. */
export function changesSince(
  entries: readonly EditEntry[],
  exportedSeq: number,
): Pick<ProjectChanges, "changes" | "since"> {
  const after = entries.filter((entry) => entry.seq > exportedSeq);
  return { changes: after.length, since: after[0]?.time };
}

/** The projects with changes since their last export, most changed first. */
export const changedProjects = (state: ReminderState): (ProjectChanges & { id: string })[] =>
  Object.entries(state.projects)
    .filter(([, project]) => project.changes > 0)
    .map(([id, project]) => ({ id, ...project }))
    .sort((one, other) => other.changes - one.changes);

/** Whether the reminder should show now, by the rules above. */
export function reminderDue(state: ReminderState, now: number): boolean {
  const changed = changedProjects(state);
  if (state.off || changed.length === 0) return false;
  const dismissedAt = state.dismissedAt ?? -Infinity;
  const many = changed.some((project) => project.changes >= MANY_CHANGES) && now - dismissedAt >= MANY_CHANGES_GAP_MS;
  const oldest = Math.min(...changed.map((project) => project.since ?? now));
  const weekly = now - Math.max(dismissedAt, oldest) >= WEEK_MS;
  return many || weekly;
}

/** A project was exported up to `exportedSeq`: nothing has changed since. */
export const withExport = (state: ReminderState, id: string, name: string, exportedSeq: number): ReminderState => ({
  ...state,
  projects: { ...state.projects, [id]: { name, exportedSeq, changes: 0 } },
});

/** The open project's log as it stands, counted against its last export. */
export function withChanges(
  state: ReminderState,
  id: string,
  name: string,
  entries: readonly EditEntry[],
): ReminderState {
  const exportedSeq = state.projects[id]?.exportedSeq ?? -1;
  return {
    ...state,
    projects: { ...state.projects, [id]: { name, exportedSeq, ...changesSince(entries, exportedSeq) } },
  };
}

export const withoutProject = (state: ReminderState, id: string): ReminderState => ({
  ...state,
  projects: Object.fromEntries(Object.entries(state.projects).filter(([other]) => other !== id)),
});

// The stored value, read through the shared persistent store.

function parse(raw: string | null): ReminderState {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as ReminderState;
    return parsed && typeof parsed.projects === "object" ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

let parsedFrom: string | null = null;
let parsed: ReminderState = EMPTY;

/** The stored state, parsed once per change so it's stable for `useSyncExternalStore`. */
export function readReminder(): ReminderState {
  const raw = readPersistent(KEY);
  if (raw !== parsedFrom) {
    parsedFrom = raw;
    parsed = parse(raw);
  }
  return parsed;
}

export const subscribeReminder = (listener: () => void): (() => void) => subscribePersistent(KEY, listener);

const update = (change: (state: ReminderState) => ReminderState) =>
  writePersistent(KEY, JSON.stringify(change(readReminder())));

export const recordExport = (id: string, name: string, entries: readonly EditEntry[]) =>
  update((state) =>
    withExport(
      state,
      id,
      name,
      entries.reduce((newest, entry) => Math.max(newest, entry.seq), -1),
    ),
  );

export const forgetProject = (id: string) => update((state) => withoutProject(state, id));

export const notNow = (now = Date.now()) => update((state) => ({ ...state, dismissedAt: now }));

export const setReminderOff = (off: boolean) => update((state) => ({ ...state, off }));

/** How long after the last edit the open project's count is brought up to date. */
const SETTLE_MS = 1000;

/**
 * Keep the open project's count current as it's edited. Settled rather than per edit, since a drag
 * emits every frame, and only while the store holds the project the app is pointed at, so a switch
 * mid-way never counts one project's log against another (HOST-24).
 */
export function attachChangeCounter(projectStore: ProjectStore, editLog: EditLog): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const count = () => {
    const id = loadedProjectId();
    if (id === null || id !== currentProjectId()) return;
    const next = withChanges(readReminder(), id, projectStore.name, editLog.getEntries());
    const before = readReminder().projects[id];
    const after = next.projects[id];
    if (before?.changes === after.changes && before?.name === after.name && before?.since === after.since) return;
    update(() => next);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(count, SETTLE_MS);
  };
  const unsubscribe = editLog.subscribe(schedule);
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
