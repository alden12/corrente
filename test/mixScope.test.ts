import { describe, expect, it } from "vitest";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { mixScope, MixScopeError } from "../src/audio/analysis/mixScope";
import { analyzeSoundRender } from "../src/audio/analysis/analyzeSound";
import { renderProject } from "../src/audio/render/renderProject";
import { nodeRenderSetup } from "../server/render/nodeRender";

/** Sixteen beats at 120 bpm (two seconds a bar): a lead in its own group, and a muted bass in another. */
const project = () => {
  const store = new ProjectStore(false);
  store.setTempo(120);
  store.setLength(64);
  const lead = store.addTrack("subtractive") as InstrumentTrack;
  store.addEffect(lead.parentId!, "chorus");
  const bass = store.addTrack("subtractive", { groupId: store.addGroup({ name: "Low" }).id }) as InstrumentTrack;
  store.setMuted(bass.id, true);
  return { store, lead, bass };
};

const loaded = (data: ReturnType<ProjectStore["snapshot"]>) => {
  const store = new ProjectStore(false);
  store.load(data);
  return store;
};

/** The lead's clip, lengthened to fill the song. */
const longClip = (store: ProjectStore, lead: InstrumentTrack) => {
  store.setClipLength(lead.id, lead.clips[0].id, 64);
  store.resizePlacement(lead.id, lead.placements[0].id, { length: 64 });
  return lead.clips[0].store;
};

describe("mixScope (AGENT-4.4): part of the mix", () => {
  it("hears the tracks asked for through their groups, unmuted, and drops the rest", () => {
    const { store, lead, bass } = project();
    const { project: scoped, heard } = mixScope(store.snapshot(), { tracks: [bass.id] });
    expect(scoped.tracks.map((track) => track.id)).toEqual([bass.id]);
    expect(scoped.tracks[0].muted).toBe(false);
    expect(scoped.groups.map((group) => group.name)).toEqual(["Low"]);
    expect(scoped.groups.some((group) => group.id === lead.parentId)).toBe(false);
    expect(heard).toMatch(/the whole arrangement/);
  });

  it("leaves the whole arrangement alone when asked for nothing narrower", () => {
    const { store } = project();
    const { project: scoped, options, heard } = mixScope(store.snapshot(), {});
    expect(scoped).toEqual(store.snapshot());
    expect(options).toEqual({ skipSec: 0 });
    expect(heard).toBe("every track, the whole arrangement");
  });

  it("plays a window in from four seconds before it, without a tail before the song's end", () => {
    const { store } = project();
    const { project: scoped, options, heard } = mixScope(store.snapshot(), { from: 32, to: 48 });
    expect(scoped.loopStart).toBe(24); // 4 s at 120 bpm is 8 beats
    expect(scoped.lengthBeats).toBe(48);
    expect(options).toEqual({ skipSec: 4, tailSec: 0 });
    expect(heard).toBe("every track, beats 32 to 48");
  });

  it("plays in from further back to catch a note held into the window, up to a limit", () => {
    const { store, lead } = project();
    const clip = longClip(store, lead);
    clip.addNote({ pitch: 48, start: 20, length: 16, velocity: 0.8 });
    expect(mixScope(store.snapshot(), { from: 32 }).project.loopStart).toBe(20);
    clip.addNote({ pitch: 50, start: 0, length: 44, velocity: 0.8 });
    expect(mixScope(store.snapshot(), { from: 40 }).project.loopStart).toBe(8); // 16 s at most
  });

  it("names a track or a window it can't hear", () => {
    const { store } = project();
    const snapshot = store.snapshot();
    expect(() => mixScope(snapshot, { tracks: ["t-nope"] })).toThrow(MixScopeError);
    expect(() => mixScope(snapshot, { from: 40, to: 32 })).toThrow(/runs from beat 0 to 64/);
    expect(() => mixScope(snapshot, { to: 80 })).toThrow(MixScopeError);
  });
});

describe("a pre-roll (skipSec)", () => {
  const windowFrom = async (start: number, length: number) => {
    const store = new ProjectStore(false);
    store.setTempo(120);
    store.setLength(64);
    const lead = store.addTrack("subtractive") as InstrumentTrack;
    longClip(store, lead).addNote({ pitch: 60, start, length, velocity: 1 });
    const { project: scoped, options } = mixScope(store.snapshot(), { from: 40, to: 44 });
    const render = await renderProject(loaded(scoped), nodeRenderSetup(), options);
    expect(render.channels[0].length).toBe(2 * 48000); // beats 40 to 44, no tail
    return (await analyzeSoundRender(render, { heard: "a window" })).summary;
  };

  it("is played but neither kept nor measured", async () => {
    // The note ends two seconds into the pre-roll, two before the window.
    expect((await windowFrom(32, 2)).peakDbfs).toBeLessThan(-60);
  });

  it("carries a note held into the window", async () => {
    expect((await windowFrom(36, 6)).peakDbfs).toBeGreaterThan(-30);
  });
});
