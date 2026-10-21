import { describe, expect, it } from "vitest";
import type { EditEntry } from "../src/audio/commands/types";
import {
  changedProjects,
  changesSince,
  reminderDue,
  withChanges,
  withExport,
  withoutProject,
  type ReminderState,
} from "../src/ui/hosting/backupReminder";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

/** `count` entries numbered from `firstSeq`, the first made at `firstTime`, a second apart. */
const entries = (count: number, firstSeq = 0, firstTime = NOW): EditEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    seq: firstSeq + index,
    time: firstTime + index * 1000,
    author: "you",
    command: { type: "renameProject", name: "x" },
  })) as EditEntry[];

const project = (changes: number, since = NOW) => ({ name: "Jam", exportedSeq: -1, changes, since });
const state = (projects: ReminderState["projects"], rest: Partial<ReminderState> = {}): ReminderState => ({
  projects,
  ...rest,
});

describe("changesSince", () => {
  it("counts every entry of a project never exported", () => {
    expect(changesSince(entries(5), -1)).toEqual({ changes: 5, since: NOW });
  });

  it("counts only the entries after the last export, from when the first was made", () => {
    expect(changesSince(entries(5), 2)).toEqual({ changes: 2, since: NOW + 3000 });
    expect(changesSince(entries(5), 4)).toEqual({ changes: 0, since: undefined });
  });
});

describe("reminderDue", () => {
  it("stays quiet with nothing changed since an export", () => {
    expect(reminderDue(state({}), NOW)).toBe(false);
    expect(reminderDue(state({ a: { name: "Jam", exportedSeq: 9, changes: 0 } }), NOW + 30 * DAY)).toBe(false);
  });

  it("asks at 250 changes, not before", () => {
    expect(reminderDue(state({ a: project(249) }), NOW)).toBe(false);
    expect(reminderDue(state({ a: project(250) }), NOW)).toBe(true);
  });

  it("asks about many changes at most once every 3 days after Not now", () => {
    const dismissed = state({ a: project(400) }, { dismissedAt: NOW });
    expect(reminderDue(dismissed, NOW + 3 * DAY - 1)).toBe(false);
    expect(reminderDue(dismissed, NOW + 3 * DAY)).toBe(true);
  });

  it("asks weekly about any change, counting from the first change or Not now, whichever is later", () => {
    expect(reminderDue(state({ a: project(1) }), NOW + 7 * DAY - 1)).toBe(false);
    expect(reminderDue(state({ a: project(1) }), NOW + 7 * DAY)).toBe(true);
    const dismissed = state({ a: project(1) }, { dismissedAt: NOW + 7 * DAY });
    expect(reminderDue(dismissed, NOW + 14 * DAY - 1)).toBe(false);
    expect(reminderDue(dismissed, NOW + 14 * DAY)).toBe(true);
  });

  it("never asks once it's turned off", () => {
    expect(reminderDue(state({ a: project(1000, 0) }, { off: true }), NOW)).toBe(false);
  });
});

describe("the state's changes", () => {
  it("counts from an export, and forgets a deleted project", () => {
    const exported = withExport(state({}), "a", "Jam", 4);
    expect(changedProjects(exported)).toEqual([]);
    const edited = withChanges(exported, "a", "Jam", entries(8));
    expect(edited.projects.a).toMatchObject({ exportedSeq: 4, changes: 3 });
    expect(changedProjects(withoutProject(edited, "a"))).toEqual([]);
  });

  it("lists the most changed first", () => {
    const listed = changedProjects(state({ a: project(3), b: project(30), c: project(0) }));
    expect(listed.map((changed) => changed.id)).toEqual(["b", "a"]);
  });
});
