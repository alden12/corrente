import { afterEach, describe, expect, it } from "vitest";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { parseCustomMidiDevice, type CustomMidiDevice } from "../src/audio/midi/custom";
import { hasMidiDevice, midiDeviceCatalogEntry } from "../src/audio/midi/device/catalog";
import { engineMidiPlan } from "../src/audio/midi/engine";
import { EngineMidiChain } from "../src/audio/bank/midiChain";
import { renderProject } from "../src/audio/render/renderProject";
import { nodeRenderSetup } from "../server/render/nodeRender";

/**
 * Custom MIDI devices in a project (INST-11.3): checked by compiling them, registered so tracks and
 * the engine play them while the project is open, saved with it, and edited in place.
 */

const strum = (direction = "up"): CustomMidiDevice => ({
  type: "cm-strum",
  label: "Strum",
  schema: [{ id: "spread", label: "Spread", kind: "number", min: 0.01, max: 0.25, default: 0.0625, taper: "linear" }],
  definition: {
    format: 1,
    nodes: {
      keys: { node: "input" },
      chord: { node: "order", inputs: { notes: "keys", direction } },
      strum: { node: "delay", inputs: { notes: "chord", beats: { per: "index", times: { param: "spread" } } } },
    },
    output: "strum",
  },
});

let open: ProjectStore | undefined;
afterEach(() => {
  // The catalogs are process-wide: take this project's devices out with it.
  open?.removeCustomMidiDevice("cm-strum");
  open = undefined;
});

const projectWithStrum = () => {
  const project = new ProjectStore(false);
  open = project;
  project.addCustomMidiDevice(strum());
  const track = project.addTrack("subtractive") as InstrumentTrack;
  project.addMidiDevice(track.id, "cm-strum");
  return { project, track };
};

describe("custom MIDI devices", () => {
  it("checks a device by compiling it, naming each problem", () => {
    expect(parseCustomMidiDevice(strum()).ok).toBe(true);
    const broken = parseCustomMidiDevice({ ...strum(), definition: { ...strum().definition, output: "keyz" } });
    expect(broken).toEqual({ ok: false, errors: [expect.stringContaining("keyz")] });
    expect(parseCustomMidiDevice({ ...strum(), schema: "no" }).ok).toBe(false);
  });

  it("registers a device for the project's tracks and the engine, and takes it out on removal", () => {
    const { project, track } = projectWithStrum();
    expect(midiDeviceCatalogEntry("cm-strum")).toMatchObject({ label: "Strum", custom: true });
    expect(engineMidiPlan("cm-strum")?.params).toEqual(["spread"]);
    const device = project.getTracks().find((each) => each.id === track.id) as InstrumentTrack;
    expect(device.midiDevices[0].type).toBe("cm-strum");
    expect(project.customDeviceUses("cm-strum")).toBe(1);
    project.removeCustomMidiDevice("cm-strum");
    expect(hasMidiDevice("cm-strum")).toBe(false);
    expect(engineMidiPlan("cm-strum")).toBeUndefined();
  });

  it("saves with the project and opens again, keeping one it can't read as it was", () => {
    const { project } = projectWithStrum();
    const unreadable = {
      type: "cm-later",
      schema: [],
      definition: { format: 1, nodes: { keys: { node: "harmonise" } }, output: "keys" },
    };
    const saved = { ...project.snapshot(), customMidiDevices: [...project.snapshot().customMidiDevices!, unreadable] };
    const reopened = new ProjectStore(false);
    reopened.load(saved);
    expect(reopened.customMidiDevices).toEqual([strum()]);
    expect((reopened.getTracks()[0] as InstrumentTrack).midiDevices[0].type).toBe("cm-strum");
    expect(reopened.snapshot().customMidiDevices).toEqual([strum(), unreadable]);
  });

  it("an edit gives the device a new plan, and the engine chain playing it loads again", () => {
    const { project, track } = projectWithStrum();
    const sent: string[] = [];
    const chain = new EngineMidiChain(
      (message) => sent.push(message.type),
      () => 0,
    );
    const devices = () => (project.getTracks().find((each) => each.id === track.id) as InstrumentTrack).midiDevices;
    chain.set(devices());
    expect(sent.filter((type) => type === "midi")).toHaveLength(1);
    chain.set(devices());
    expect(sent.filter((type) => type === "midi")).toHaveLength(1);
    project.addCustomMidiDevice(strum("alternate"));
    chain.set(devices());
    expect(sent.filter((type) => type === "midi")).toHaveLength(2);
    chain.dispose();
  });

  it("plays in the engine: a chord through a strum sounds like the chord staggered by hand", async () => {
    const chord = (spread: number) =>
      [60, 64, 67].map((pitch, index) => ({ pitch, start: index * spread, length: 2, velocity: 0.8 }));
    const render = (project: ProjectStore, notes: ReturnType<typeof chord>) => {
      project.setTempo(120);
      project.setLength(4);
      const track = project.getTracks()[0] as InstrumentTrack;
      notes.forEach((note) => track.clips[0].store.addNote(note));
      return renderProject(project, nodeRenderSetup(), { tailSec: 1 });
    };
    // A spread of a sixteenth (a quarter beat).
    const { project, track } = projectWithStrum();
    track.midiDevices[0].params.set("spread", 0.25);
    const strummed = await render(project, chord(0));
    const byHand = new ProjectStore(false);
    byHand.addTrack("subtractive");
    const expected = await render(byHand, chord(0.25));
    const difference = strummed.channels[0].reduce(
      (most, sample, index) => Math.max(most, Math.abs(sample - expected.channels[0][index])),
      0,
    );
    expect(difference).toBeLessThan(1e-4);
  }, 30000);

  it("plays in the song's key: a step up in degrees sounds like the notes moved by hand, in each key", async () => {
    const stepUp: CustomMidiDevice = {
      type: "cm-step-up",
      schema: [],
      definition: {
        format: 1,
        nodes: { keys: { node: "input" }, up: { node: "degrees", inputs: { notes: "keys", steps: 1 } } },
        output: "up",
      },
    };
    // E, then B: a step up is F and C in C major, F# and C# in D major.
    const melody = (pitches: number[]) =>
      pitches.map((pitch, index) => ({ pitch, start: index, length: 1, velocity: 0.8 }));
    const render = (key: number, notes: ReturnType<typeof melody>, withDevice: boolean) => {
      const project = new ProjectStore(false);
      project.setTempo(120);
      project.setLength(4);
      project.setKey(key, "major");
      if (withDevice) project.addCustomMidiDevice(stepUp);
      const track = project.addTrack("subtractive") as InstrumentTrack;
      if (withDevice) project.addMidiDevice(track.id, "cm-step-up");
      notes.forEach((note) => track.clips[0].store.addNote(note));
      // The catalogs are process-wide: take the device out once it's rendered.
      return renderProject(project, nodeRenderSetup(), { tailSec: 1 }).finally(
        () => withDevice && project.removeCustomMidiDevice("cm-step-up"),
      );
    };
    const largestDifference = (left: Float32Array, right: Float32Array) =>
      left.reduce((most, sample, index) => Math.max(most, Math.abs(sample - right[index])), 0);
    const cases = [
      { key: 0, moved: [65, 72] },
      { key: 2, moved: [66, 73] },
    ];
    for (const { key, moved } of cases) {
      const played = await render(key, melody([64, 71]), true);
      const byHand = await render(key, melody(moved), false);
      expect(largestDifference(played.channels[0], byHand.channels[0])).toBeLessThan(1e-4);
    }
  }, 30000);
});
