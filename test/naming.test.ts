import { describe, expect, it } from "vitest";
import { freeName } from "../src/audio/project/naming";
import { ProjectStore } from "../src/audio/project/projectStore";

describe("a new thing's default name", () => {
  it("is the plain name while it's free, then the lowest free number from 2", () => {
    expect(freeName("Drum Kit", [])).toBe("Drum Kit");
    expect(freeName("Drum Kit", ["Micro VA", "Drum Kit"])).toBe("Drum Kit 2");
    expect(freeName("Drum Kit", ["Drum Kit", "Drum Kit 3"])).toBe("Drum Kit 2");
    expect(freeName("Drum Kit", ["Drum Kit", "Drum Kit 2"])).toBe("Drum Kit 3");
  });

  it("names a project's tracks by what is taken, not by how many tracks there are", () => {
    const project = new ProjectStore(false);
    project.addTrack("subtractive");
    project.addTrack("drumkit");
    expect(project.getTracks().map((track) => track.name)).toEqual(["Subtractive", "Drum Kit"]);
    expect(project.defaultTrackName("drumkit")).toBe("Drum Kit 2");
  });
});
