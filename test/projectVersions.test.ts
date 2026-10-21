import { describe, expect, it } from "vitest";
import type { EditEntry } from "../src/audio/commands/types";
import { ProjectStore } from "../src/audio/project/projectStore";
import { editKeys, exportFileName, fileStem, relationOf, versionHash } from "../src/audio/projects/projectVersions";

const edit = (id: string | undefined, seq: number): EditEntry =>
  ({ seq, id, command: { type: "setTempo", bpm: 120 + seq }, author: "you" }) as EditEntry;

describe("relationOf", () => {
  const local = ["a", "b", "c"];

  it("is absent with no local project", () => {
    expect(relationOf(undefined, ["a"])).toBe("absent");
  });

  it("tells the same version, an earlier one, a newer one and a fork apart", () => {
    expect(relationOf(local, ["a", "b", "c"])).toBe("same");
    expect(relationOf(local, ["a", "b"])).toBe("earlier");
    expect(relationOf(local, [])).toBe("earlier");
    expect(relationOf(local, ["a", "b", "c", "d"])).toBe("newer");
    expect(relationOf(local, ["a", "b", "x"])).toBe("diverged");
  });
});

describe("editKeys", () => {
  it("uses each edit's id, or its order for an old one without", () => {
    expect(editKeys([edit("e1", 0), edit(undefined, 1)])).toEqual(["e1", "seq:1"]);
  });
});

describe("export file names", () => {
  it("name the project, the day and the version", () => {
    expect(exportFileName("Deep House Jam!", new Date(2026, 9, 21, 23, 30), "a3f9c2")).toBe(
      "deep-house-jam-2026-10-21-a3f9c2.daw.zip",
    );
    expect(fileStem("***")).toBe("project");
  });

  it("give one version one hash, and another version another", async () => {
    const project = new ProjectStore(false).snapshot();
    const log = [edit("e1", 0), edit("e2", 1)];
    expect(await versionHash(log, project)).toBe(await versionHash([...log], project));
    expect(await versionHash(log, project)).not.toBe(await versionHash(log.slice(0, 1), project));
    expect(await versionHash([], project)).toMatch(/^[0-9a-f]{6}$/);
  });
});
