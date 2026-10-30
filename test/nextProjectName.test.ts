import { describe, expect, it } from "vitest";
import { nextProjectName } from "../src/audio/projects/library";

/** A new project's default name: Project N, one past the highest, so new ones can be told apart. */

describe("a new project's default name", () => {
  it("starts at Project 1", () => {
    expect(nextProjectName([])).toBe("Project 1");
    expect(nextProjectName(["Untitled", "Night Drive"])).toBe("Project 1");
  });

  it("goes one past the highest Project N, leaving gaps", () => {
    expect(nextProjectName(["Project 1", "Project 2"])).toBe("Project 3");
    expect(nextProjectName(["Project 4", "Project 1"])).toBe("Project 5");
  });

  it("counts only names that are exactly Project N", () => {
    expect(nextProjectName(["Project 9 (copy)", "My Project 7", "Project 2"])).toBe("Project 3");
  });
});
