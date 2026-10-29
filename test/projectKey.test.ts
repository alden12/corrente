import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { applyEdit } from "../src/audio/commands/applyEdit";
import { describeCommand } from "../src/audio/commands/describe";
import { diffProjects } from "../src/audio/commands/diff";
import { DEFAULT_KEY, keyLabel, scaleMask } from "../src/audio/theory/key";
import { EngineBank } from "../src/audio/bank/bank";
import { RATE, wasm } from "./support/engine";

/**
 * The song's key (DAW-12): on the project, C major until it's set, set by an edit, saved with the
 * song, and heard by the engine.
 */

describe("the project's key", () => {
  it("is C major for a new project and for one saved before keys", () => {
    expect(new ProjectStore(false).key).toEqual(DEFAULT_KEY);
    const beforeKeys = { ...new ProjectStore(false).snapshot(), key: undefined };
    const opened = new ProjectStore(false);
    opened.load(beforeKeys);
    expect(keyLabel(opened.key)).toBe("C major");
  });

  it("is set by an edit, saved with the song, and described in history", () => {
    const project = new ProjectStore(false);
    const before = project.snapshot();
    const command = { type: "setKey", tonic: 9, scale: "minor" } as const;
    applyEdit(project, command, "user");
    expect(project.getStructure().key).toEqual({ tonic: 9, scale: "minor" });
    const reopened = new ProjectStore(false);
    reopened.load(project.snapshot());
    expect(keyLabel(reopened.key)).toBe("A minor");
    expect(describeCommand(command, { project })).toBe("Set key to A minor");
    expect(diffProjects(before, project.snapshot())).toContain("Key C major -> A minor");
  });

  it("wraps a tonic round the octave, and keeps the scale it has for one it doesn't know", () => {
    const project = new ProjectStore(false);
    project.setKey(14, "dorian");
    expect(keyLabel(project.key)).toBe("D dorian");
    project.setKey(-1, "nonsense" as "major");
    expect(keyLabel(project.key)).toBe("B dorian");
  });

  it("gives the engine each scale as the notes in it, as bits from the tonic", () => {
    expect(scaleMask("major")).toBe(0b1010_1011_0101);
    expect(scaleMask("minor pentatonic")).toBe(0b0100_1010_1001);
    // The engine takes it without complaint (what the MIDI nodes in degrees will read).
    expect(() => new EngineBank(wasm, RATE, 1).setKey({ tonic: 9, scale: scaleMask("minor") })).not.toThrow();
  });
});
