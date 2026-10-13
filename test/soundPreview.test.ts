import { describe, expect, it } from "vitest";
import { SoundPreview, type PreviewEngine } from "../src/audio/live/preview";
import { LiveNotes, type InstrumentTarget } from "../src/audio/live/liveNotes";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { instrumentSound } from "../src/audio/patches/sound";
import { FACTORY_PATCHES } from "../src/audio/patches/factory";

function fakeTarget() {
  const on: number[] = [];
  const off: number[] = [];
  const target: InstrumentTarget = { noteOn: (note) => on.push(note), noteOff: (note) => off.push(note) };
  return { target, on, off };
}

function fakeEngine() {
  const playing = fakeTarget();
  let track: InstrumentTrack | null = null;
  const engine: PreviewEngine = {
    setPreview: (next) => (track = next),
    getPreviewTarget: () => (track ? playing.target : undefined),
    playSample: async () => null,
    stopSample: () => undefined,
    sampleDuration: async () => null,
  };
  return { engine, playing, track: () => track };
}

describe("SoundPreview", () => {
  it("plays a patch on its own track, outside the project", () => {
    const { engine, track } = fakeEngine();
    const preview = new SoundPreview(engine);
    const patch = FACTORY_PATCHES[0];
    preview.open("patch:x", patch);

    expect(preview.getState()?.key).toBe("patch:x");
    expect(track()?.instrumentType).toBe(patch.instrumentType);
    expect(track()?.effects.map((effect) => effect.type)).toEqual(patch.effects.map((effect) => effect.type));
  });

  it("carries knob turns into the sound it hands on", () => {
    const { engine } = fakeEngine();
    const preview = new SoundPreview(engine);
    preview.open("instrument:subtractive", instrumentSound("subtractive", "Subtractive"));
    const spec = preview
      .getState()!
      .track.params.allSpecs()
      .find((each) => each.kind === "number")!;
    preview.getState()!.track.params.set(spec.id, (spec as { min: number }).min);

    expect(preview.current()?.params[spec.id]).toBe((spec as { min: number }).min);
    expect(preview.current()?.name).toBe("Subtractive");
  });

  it("tears the engine's preview down on close", () => {
    const { engine, track } = fakeEngine();
    const preview = new SoundPreview(engine);
    preview.open("a", instrumentSound("subtractive", "Subtractive"));
    preview.close();

    expect(track()).toBeNull();
    expect(preview.getState()).toBeNull();
    expect(preview.current()).toBeNull();
  });
});

describe("LiveNotes while trying a sound", () => {
  it("plays the tried sound instead of the selected track, and releases it there", () => {
    const { engine, playing } = fakeEngine();
    const preview = new SoundPreview(engine);
    const selected = fakeTarget();
    const recorded = fakeTarget();
    const live = new LiveNotes(
      { getNoteTarget: () => selected.target },
      { selectedId: "t1" },
      recorded.target,
      preview,
    );

    preview.open("a", instrumentSound("subtractive", "Subtractive"));
    live.noteOn(60);
    live.noteOff(60);
    expect(playing.on).toEqual([60]);
    expect(playing.off).toEqual([60]);
    expect(selected.on).toEqual([]);
    expect(recorded.on).toEqual([60]); // the recorder hears it, so a take can capture it

    preview.close();
    live.noteOn(62);
    expect(selected.on).toEqual([62]);
  });
});

describe("createTrackFromPatch with a take", () => {
  const take = {
    id: "clip-1",
    placementId: "pl-1",
    name: "Take 1",
    notes: [{ id: "n1", pitch: 60, start: 0, length: 1, velocity: 0.8 }],
    lengthBeats: 4,
    startBeat: 8,
  };

  it("starts the track with the take in place of the empty seed clip", () => {
    const store = new ProjectStore(false);
    const track = store.addTrackFromPatch({ id: "t1", instrumentType: "subtractive", params: {}, effects: [], take });

    expect(track.kind).toBe("instrument");
    const instrument = track as InstrumentTrack;
    expect(instrument.clips.map((clip) => clip.id)).toEqual(["clip-1"]);
    expect(instrument.clips[0].store.getClip().notes.map((note) => note.pitch)).toEqual([60]);
    expect(instrument.placements).toEqual([{ id: "pl-1", clipId: "clip-1", startBeat: 8, offset: 0, length: 4 }]);
  });

  it("is one undo step: the track and its take go together", () => {
    const store = new ProjectStore(false);
    const log = new EditLog(store);
    log.dispatch({
      type: "createTrackFromPatch",
      id: "t1",
      instrumentType: "subtractive",
      params: {},
      effects: [],
      take,
    });
    expect(store.getTracks().map((each) => each.id)).toEqual(["t1"]);

    log.undo();
    expect(store.getTracks()).toEqual([]);
  });
});
