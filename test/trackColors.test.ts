import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { applyEdit } from "../src/audio/commands/applyEdit";
import { summarizeProject } from "../src/audio/projects/summary";
import { colorAt } from "../src/audio/deviceColors";

/**
 * Track and clip colours (DAW-47): a track has one, its clips take it unless they have their own,
 * and a project from before them is coloured by its tracks' places.
 */
describe("track colours", () => {
  it("gives each new track a colour no track has yet", () => {
    const project = new ProjectStore(false);
    const colors = ["a", "b", "c", "d"].map((id) => project.addTrack("subtractive", { id }).color);
    expect(new Set(colors).size).toBe(4);
    // A colour freed by a removed track is the next one taken.
    project.removeTrack("b");
    expect(project.addTrack("subtractive", { id: "e" }).color).toBe(colors[1]);
  });

  it("colours a track and a clip by edits, and a clip goes back to its track's", () => {
    const project = new ProjectStore(false);
    const track = project.addTrack("subtractive", { id: "t" });
    const clipId = track.clips[0].id;
    applyEdit(project, { type: "setTrack", trackId: "t", color: "violet" }, "you");
    applyEdit(project, { type: "setClipColor", trackId: "t", clipId, color: "amber" }, "you");
    expect(project.getTrack("t")?.color).toBe("violet");
    expect(project.getTrack("t")?.clips[0].color).toBe("amber");

    // Saved and loaded, they stay.
    const reloaded = new ProjectStore(false);
    reloaded.load(project.snapshot());
    expect(reloaded.getTrack("t")?.color).toBe("violet");
    expect(reloaded.getTrack("t")?.clips[0].color).toBe("amber");

    applyEdit(project, { type: "setClipColor", trackId: "t", clipId, color: null }, "you");
    expect(project.getTrack("t")?.clips[0].color).toBeUndefined();
    expect(project.snapshot().tracks[0].clips?.[0]).not.toHaveProperty("color");
  });

  it("colours a project from before colours by its tracks' places", () => {
    const project = new ProjectStore(false);
    ["a", "b"].forEach((id) => project.addTrack("subtractive", { id }));
    const old = project.snapshot();
    const uncoloured = { ...old, tracks: old.tracks.map((track) => ({ ...track, color: undefined })) };
    const loaded = new ProjectStore(false);
    loaded.load(uncoloured);
    expect(loaded.getTracks().map((track) => track.color)).toEqual([colorAt(0), colorAt(1)]);
  });

  it("summarizes each clip's colour for the thumbnails", () => {
    const project = new ProjectStore(false);
    const track = project.addTrack("subtractive", { id: "t" });
    applyEdit(project, { type: "setTrack", trackId: "t", color: "cyan" }, "you");
    expect(summarizeProject(project.snapshot()).colors).toEqual([["cyan"]]);
    applyEdit(project, { type: "setClipColor", trackId: "t", clipId: track.clips[0].id, color: "red" }, "you");
    expect(summarizeProject(project.snapshot()).colors).toEqual([["red"]]);
  });
});
