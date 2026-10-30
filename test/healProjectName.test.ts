import { describe, expect, it, vi } from "vitest";
import { healProjectName } from "../src/audio/projects/healName";

/** A project still called "Untitled" takes back the name the list knows it by (DAW-90). */

const heal = (name: string, known: (string | undefined)[]) => {
  const dispatch = vi.fn();
  healProjectName({ name }, { dispatch }, known);
  return dispatch;
};

describe("healing a project's name as it opens", () => {
  it("renames an Untitled project to the name the list knows, as an edit", () => {
    expect(heal("Untitled", ["Euclidean", "Old"])).toHaveBeenCalledWith({ type: "renameProject", name: "Euclidean" });
  });

  it("falls back to meta.json's name when the list's is the default too", () => {
    expect(heal("Untitled", ["Untitled", "Test"])).toHaveBeenCalledWith({ type: "renameProject", name: "Test" });
  });

  it("leaves a project with a real name alone, whatever the list says", () => {
    expect(heal("Night Drive", ["Euclidean"])).not.toHaveBeenCalled();
  });

  it("does nothing when nowhere knows a better name", () => {
    expect(heal("Untitled", [undefined, "Untitled", "  "])).not.toHaveBeenCalled();
  });
});
