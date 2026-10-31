import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { addStarterSong, STARTER_CLIP_NAME } from "../src/audio/project/starter";
import {
  MORNING_BEATS,
  MORNING_LEAD,
  MORNING_PAD,
  MORNING_TEMPO,
  MORNING_TIMPANI,
} from "../src/audio/project/morningSong";

const noteCounts = (project: ProjectStore) =>
  project.getTracks().map((track) => project.getClipStore(track.id)?.getClip().notes.length);

describe("the starter project (DAW-76, DAW-94)", () => {
  it("plays the Morning Song: the starter track takes the lead, a Sampler and a Pad join it", () => {
    const project = new ProjectStore();
    addStarterSong(project);
    const tracks = project.getTracks();
    expect(tracks.map((track) => track.kind === "instrument" && track.instrumentType)).toEqual([
      "micro-va",
      "sampler",
      "pad",
    ]);
    expect(noteCounts(project)).toEqual([MORNING_LEAD.length, MORNING_TIMPANI.length, MORNING_PAD.length]);
    expect(tracks.every((track) => track.kind === "instrument" && track.clips[0].name === STARTER_CLIP_NAME)).toBe(
      true,
    );
    expect(project.tempo).toBe(MORNING_TEMPO);
    // The lead is still the track you land on.
    expect(project.selectedId).toBe(tracks[0].id);
  });

  it("plays the timpani on the 808 kick through a reverb, and doubles the pad's C with the octavator", () => {
    const project = new ProjectStore();
    addStarterSong(project);
    const [, timpani, pad] = project.getTracks();
    expect(timpani.kind === "instrument" && timpani.params.get("sampler.sample")).toBe("builtin:808-kick");
    expect(timpani.effects.map((effect) => effect.type)).toEqual(["reverb"]);
    expect(pad.kind === "instrument" && pad.midiDevices.map((device) => device.type)).toEqual(["octavator"]);
  });

  it("adds it once, as boot can run twice", () => {
    const project = new ProjectStore();
    addStarterSong(project);
    addStarterSong(project);
    expect(project.getTracks()).toHaveLength(3);
    expect(noteCounts(project)[0]).toBe(MORNING_LEAD.length);
  });

  it("fits every part in a clip as long as the song, placed whole, so all of it plays", () => {
    const project = new ProjectStore();
    addStarterSong(project);
    for (const part of [MORNING_LEAD, MORNING_TIMPANI, MORNING_PAD])
      expect(Math.max(...part.map((note) => note.start + (note.length ?? 0)))).toBeLessThanOrEqual(MORNING_BEATS);
    for (const track of project.getTracks()) {
      expect(project.getClipStore(track.id)?.getClip().lengthBeats).toBe(MORNING_BEATS);
      expect(track.placements).toMatchObject([{ startBeat: 0, length: MORNING_BEATS }]);
    }
  });
});
