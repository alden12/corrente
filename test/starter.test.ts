import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { addStarterMelody, STARTER_CLIP_NAME, STARTER_MELODY } from "../src/audio/project/starter";

describe("the starter project (DAW-76)", () => {
  it("puts the example melody in the starter track's clip, named as an example", () => {
    const project = new ProjectStore();
    addStarterMelody(project);
    const [track] = project.getTracks();
    const clip = project.getClipStore(track.id)?.getClip();
    expect(clip?.notes).toHaveLength(STARTER_MELODY.length);
    expect(track.kind === "instrument" && track.clips[0].name).toBe(STARTER_CLIP_NAME);
  });

  it("adds it once, as boot can run twice", () => {
    const project = new ProjectStore();
    addStarterMelody(project);
    addStarterMelody(project);
    expect(project.getClipStore(project.getTracks()[0].id)?.getClip().notes).toHaveLength(STARTER_MELODY.length);
  });

  it("fits the starter clip, so all of it plays", () => {
    const project = new ProjectStore();
    const lengthBeats = project.getClipStore(project.getTracks()[0].id)!.getClip().lengthBeats;
    expect(Math.max(...STARTER_MELODY.map((note) => note.start + (note.length ?? 0)))).toBeLessThanOrEqual(lengthBeats);
  });
});
