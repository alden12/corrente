import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { addStarterSong } from "../src/audio/project/starter";
import {
  MORNING_BEATS,
  MORNING_CHORDS,
  MORNING_DRUMS,
  MORNING_LEAD,
  MORNING_PAD,
  MORNING_SECTION,
  MORNING_TEMPO,
} from "../src/audio/project/morningSong";

const PARTS = [MORNING_CHORDS, MORNING_DRUMS, MORNING_PAD, MORNING_LEAD];

const started = () => {
  const project = new ProjectStore();
  addStarterSong(project);
  return project;
};

describe("the starter project (DAW-76, DAW-94)", () => {
  it("plays the Morning Song: the starter track takes the chords, and drums, a pad and a lead join it", () => {
    const project = started();
    const tracks = project.getTracks();
    expect(tracks.map((track) => [track.name, track.kind === "instrument" && track.instrumentType])).toEqual([
      ["Chords", "micro-va"],
      ["Drums", "sampler"],
      ["Pad", "pad"],
      ["Lead", "micro-va"],
    ]);
    expect(project.tempo).toBe(MORNING_TEMPO);
    expect(project.length).toBe(MORNING_BEATS);
    // The chords are still the track you land on.
    expect(project.selectedId).toBe(tracks[0].id);
  });

  it("gives each part its clips, a section long, placed at their sections", () => {
    const project = started();
    project.getTracks().forEach((track, index) => {
      const part = PARTS[index];
      if (track.kind !== "instrument") throw new Error("instrument tracks only");
      expect(track.clips.map((clip) => clip.name)).toEqual(part.map((clip) => clip.name));
      expect(track.clips.map((clip) => clip.store.getClip().notes.length)).toEqual(
        part.map((clip) => clip.notes.length),
      );
      expect(track.clips.every((clip) => clip.store.getClip().lengthBeats === MORNING_SECTION)).toBe(true);
      const placed = part.flatMap((songClip, clipIndex) =>
        songClip.at.map((startBeat) => ({ clipId: track.clips[clipIndex].id, startBeat, length: MORNING_SECTION })),
      );
      expect(track.placements).toMatchObject(placed);
    });
  });

  it("fits every note in its clip and every section in the song", () => {
    for (const songClip of PARTS.flat()) {
      expect(Math.max(...songClip.notes.map((note) => note.start + (note.length ?? 0)))).toBeLessThanOrEqual(
        MORNING_SECTION,
      );
      expect(Math.max(...songClip.at) + MORNING_SECTION).toBeLessThanOrEqual(MORNING_BEATS);
    }
  });

  it("plays the timpani on the 808 kick through a reverb, and doubles the pad with the octavator", () => {
    const [, drums, pad] = started().getTracks();
    expect(drums.kind === "instrument" && drums.params.get("sampler.sample")).toBe("builtin:808-kick");
    expect(drums.effects.map((effect) => effect.type)).toEqual(["reverb"]);
    expect(pad.kind === "instrument" && pad.midiDevices.map((device) => device.type)).toEqual(["octavator"]);
  });

  it("adds it once, as boot can run twice", () => {
    const project = started();
    addStarterSong(project);
    expect(project.getTracks()).toHaveLength(4);
    expect(project.getTracks()[0].placements).toHaveLength(MORNING_CHORDS.length);
  });
});
