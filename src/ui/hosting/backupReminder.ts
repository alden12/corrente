/**
 * The backup reminder (HOST-23.2.1.2): whether the open project has changed enough since its last
 * export to say so. A standalone run's projects live only in this browser, and an export is the
 * copy that survives it, so the reminder is about exports and nothing else. Only the open project:
 * a reminder about another one would read as being about this one (Alden, 2026-10-21).
 *
 * The rules, agreed 2026-10-21:
 * - **250 changes** since the last export, at most **once every 3 days**;
 * - **at least once a week** while there are any changes since the last export;
 * - **Not now** puts it away until a rule next fires, measured from then;
 * - **Don't ask me again** turns it off, until it's turned back on from the panel.
 *
 * A change is an entry in the edit log after the newest one the last export carried, so an undo
 * counts too, and a project never exported counts all of its history. The count is read from the
 * live log whenever it changes, so all that's stored (in localStorage, through `persistentStore`) is
 * each project's last exported entry and the reminder's own settings.
 */
import { useCallback, useSyncExternalStore } from "react";
import { currentProjectId, loadedProjectId, subscribeCurrentProject } from "../../audio/projectRepository";
import type { EditLog } from "../../audio/commands/editLog";
import type { EditEntry } from "../../audio/commands/types";
import { readPersistent, subscribePersistent, writePersistent } from "../persistentStore";

const KEY = "corrente:backup-reminder";
const DAY_MS = 24 * 60 * 60 * 1000;
export const MANY_CHANGES = 250;
const MANY_CHANGES_GAP_MS = 3 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;

export interface ReminderState {
  /** Each project's newest log entry its last export carried. */
  exported: Record<string, number>;
  /** When the reminder was last put away with Not now. */
  dismissedAt?: number;
  /** Don't ask me again. */
  off?: boolean;
}

export interface Changes {
  count: number;
  /** When the first of them was made, if there are any. */
  since?: number;
}

const EMPTY: ReminderState = { exported: {} };

/** The entries after `exportedSeq` (-1 for never exported): how many, and when the first was made. */
export function changesSince(entries: readonly EditEntry[], exportedSeq = -1): Changes {
  const after = entries.filter((entry) => entry.seq > exportedSeq);
  return { count: after.length, since: after[0]?.time };
}

/** Whether the reminder should show now, by the rules above. */
export function reminderDue(changes: Changes, state: ReminderState, now: number): boolean {
  if (state.off || changes.count === 0) return false;
  const dismissedAt = state.dismissedAt ?? -Infinity;
  const many = changes.count >= MANY_CHANGES && now - dismissedAt >= MANY_CHANGES_GAP_MS;
  const weekly = now - Math.max(dismissedAt, changes.since ?? now) >= WEEK_MS;
  return many || weekly;
}

export const withExport = (state: ReminderState, id: string, exportedSeq: number): ReminderState => ({
  ...state,
  exported: { ...state.exported, [id]: exportedSeq },
});

export const withoutProject = (state: ReminderState, id: string): ReminderState => ({
  ...state,
  exported: Object.fromEntries(Object.entries(state.exported).filter(([other]) => other !== id)),
});

// The stored value, read through the shared persistent store.

function parse(raw: string | null): ReminderState {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as ReminderState;
    return parsed && typeof parsed.exported === "object" ? parsed : EMPTY;
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

const subscribeReminder = (listener: () => void): (() => void) => subscribePersistent(KEY, listener);

const update = (change: (state: ReminderState) => ReminderState) =>
  writePersistent(KEY, JSON.stringify(change(readReminder())));

/** A project was exported with these entries: its changes count from the newest of them. */
export const recordExport = (id: string, entries: readonly EditEntry[]) =>
  update((state) =>
    withExport(
      state,
      id,
      entries.reduce((newest, entry) => Math.max(newest, entry.seq), -1),
    ),
  );

export const forgetProject = (id: string) => update((state) => withoutProject(state, id));

export const notNow = (now = Date.now()) => update((state) => ({ ...state, dismissedAt: now }));

export const setReminderOff = (off: boolean) => update((state) => ({ ...state, off }));

export const useReminderState = (): ReminderState =>
  useSyncExternalStore(subscribeReminder, readReminder, readReminder);

/**
 * The open project's changes since its last export, as `count:since`: a string so the snapshot is
 * stable between renders. None while a switch is under way, when the log is still the last
 * project's (HOST-24).
 */
function changesKey(editLog: EditLog): string {
  const id = loadedProjectId();
  if (id === null || id !== currentProjectId()) return "0:";
  const { count, since } = changesSince(editLog.getEntries(), readReminder().exported[id]);
  return `${count}:${since ?? ""}`;
}

/** The open project's changes since its last export, kept current as it's edited; none without a log. */
export function useOpenProjectChanges(editLog: EditLog | undefined): Changes {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!editLog) return () => {};
      const unsubscribers = [
        editLog.subscribe(listener),
        subscribeCurrentProject(listener),
        subscribeReminder(listener),
      ];
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    [editLog],
  );
  const snapshot = useCallback(() => (editLog ? changesKey(editLog) : "0:"), [editLog]);
  const [count, since] = useSyncExternalStore(subscribe, snapshot, snapshot).split(":");
  return { count: Number(count), since: since ? Number(since) : undefined };
}
