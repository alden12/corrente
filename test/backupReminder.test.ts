import { describe, expect, it } from "vitest";
import type { EditEntry } from "../src/audio/commands/types";
import {
  changesSince,
  reminderDue,
  withExport,
  withoutProject,
  type ReminderState,
} from "../src/ui/hosting/backupReminder";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

/** `count` entries numbered from 0, the first made at NOW, a second apart. */
const entries = (count: number): EditEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    seq: index,
    time: NOW + index * 1000,
    author: "you",
    command: { type: "renameProject", name: "x" },
  })) as EditEntry[];

const state = (rest: Partial<ReminderState> = {}): ReminderState => ({ exported: {}, ...rest });
const changes = (count: number, since = NOW) => ({ count, since });

describe("changesSince", () => {
  it("counts every entry of a project never exported", () => {
    expect(changesSince(entries(5))).toEqual({ count: 5, since: NOW });
  });

  it("counts only the entries after the last export, from when the first was made", () => {
    expect(changesSince(entries(5), 2)).toEqual({ count: 2, since: NOW + 3000 });
    expect(changesSince(entries(5), 4)).toEqual({ count: 0, since: undefined });
  });
});

describe("reminderDue", () => {
  it("stays quiet with nothing changed since an export", () => {
    expect(reminderDue(changes(0), state(), NOW + 30 * DAY)).toBe(false);
  });

  it("asks at 250 changes, not before", () => {
    expect(reminderDue(changes(249), state(), NOW)).toBe(false);
    expect(reminderDue(changes(250), state(), NOW)).toBe(true);
  });

  it("asks about many changes at most once every 3 days after Not now", () => {
    const dismissed = state({ dismissedAt: NOW });
    expect(reminderDue(changes(400), dismissed, NOW + 3 * DAY - 1)).toBe(false);
    expect(reminderDue(changes(400), dismissed, NOW + 3 * DAY)).toBe(true);
  });

  it("asks weekly about any change, counting from the first change or Not now, whichever is later", () => {
    expect(reminderDue(changes(1), state(), NOW + 7 * DAY - 1)).toBe(false);
    expect(reminderDue(changes(1), state(), NOW + 7 * DAY)).toBe(true);
    const dismissed = state({ dismissedAt: NOW + 7 * DAY });
    expect(reminderDue(changes(1), dismissed, NOW + 14 * DAY - 1)).toBe(false);
    expect(reminderDue(changes(1), dismissed, NOW + 14 * DAY)).toBe(true);
  });

  it("never asks once it's turned off", () => {
    expect(reminderDue(changes(1000, 0), state({ off: true }), NOW)).toBe(false);
  });
});

describe("the stored exports", () => {
  it("keeps each project's last exported entry, and forgets a deleted project", () => {
    const exported = withExport(state(), "a", 4);
    expect(changesSince(entries(8), exported.exported.a).count).toBe(3);
    expect(withoutProject(exported, "a").exported).toEqual({});
  });
});
