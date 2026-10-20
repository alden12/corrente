import { beforeEach, describe, expect, it } from "vitest";
import type { CustomDevice } from "../src/audio/definitions/custom";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { applyEdit } from "../src/audio/commands/applyEdit";
import type { EditCommand } from "../src/audio/commands/types";
import { memoryBackend } from "../src/audio/library/backend";
import { keepDevicesOf, libraryDevice, libraryDevices, settingsReset } from "../src/audio/library/devices";
import { EditLog } from "../src/audio/commands/editLog";
import { libraryEntry } from "../src/audio/library/store";
import { openLibrary, listPatches } from "../src/audio/patches/library";
import { patchTrackCommand, savePatchFromTrack } from "../src/audio/patches/patchTools";
import { SoundPreview, type PreviewEngine } from "../src/audio/live/preview";
import { instrumentSchema } from "../src/audio/instruments/catalog";

const synth: CustomDevice = {
  type: "ci-lib00001",
  label: "Library Synth",
  schema: [{ id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 }],
  definition: {
    format: 1,
    nodes: {
      osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      envelope: { block: "adsr", voice: true, inputs: { gate: "voice.gate" } },
      amp: { block: "mul", voice: true, inputs: { a: "osc", b: "envelope" } },
      left: { block: "mul", inputs: { a: "voices.left", b: { param: "level" } } },
      right: { block: "mul", inputs: { a: "voices.right", b: { param: "level" } } },
    },
    voice: "amp",
    output: ["left", "right"],
  },
};

const gain: CustomDevice = {
  type: "ce-lib00001",
  schema: [{ id: "gain", label: "Gain", kind: "number", min: 0, max: 2, default: 1 }],
  definition: {
    format: 1,
    nodes: {
      left: { block: "mul", inputs: { a: "input.left", b: { param: "gain" } } },
      right: { block: "mul", inputs: { a: "input.right", b: { param: "gain" } } },
    },
    output: ["left", "right"],
  },
};

/** A project with a track playing the custom synth through the custom effect. */
function madeWithDevices() {
  const project = new ProjectStore(false);
  project.addCustomInstrument(synth);
  project.addCustomEffect(gain);
  const track = project.addTrack(synth.type) as InstrumentTrack;
  project.addEffect(track.id, gain.type);
  return { project, track };
}

/** Add a track from a library patch, as the patch tools do. */
const addFrom = (project: ProjectStore, patch: string, id: string) =>
  applyEdit(project, { ...patchTrackCommand(patch), id } as EditCommand, "you");

describe("custom devices travel with patches (COMM-1.11.1)", () => {
  beforeEach(() => openLibrary(memoryBackend()));

  it("a patch carries the devices it plays, and keeps them in the library too", () => {
    const { project, track } = madeWithDevices();
    const saved = savePatchFromTrack(track, "you", project, { name: "Custom" });
    expect(saved.devices?.instruments?.map((device) => device.type)).toEqual([synth.type]);
    expect(saved.devices?.effects?.map((device) => device.type)).toEqual([gain.type]);
    expect(libraryDevices("instrument").map((device) => device.type)).toEqual([synth.type]);
    expect(libraryDevices("effect").map((device) => device.type)).toEqual([gain.type]);
  });

  it("brings them into a project that doesn't have them, and reuses ones it does", () => {
    const { project, track } = madeWithDevices();
    const saved = savePatchFromTrack(track, "you", project, { name: "Custom" });

    const elsewhere = new ProjectStore(false);
    addFrom(elsewhere, saved.id, "t-first");
    expect(elsewhere.customInstruments.map((device) => device.type)).toEqual([synth.type]);
    expect(elsewhere.customEffects.map((device) => device.type)).toEqual([gain.type]);
    const added = elsewhere.getTrack("t-first") as InstrumentTrack;
    expect(added.instrumentType).toBe(synth.type);
    expect(added.effects.map((effect) => effect.type)).toEqual([gain.type]);

    addFrom(elsewhere, saved.id, "t-second");
    expect(elsewhere.customInstruments).toHaveLength(1);
  });

  it("plays the project's own version where it already has the device, changing nothing it plays", () => {
    const { project, track } = madeWithDevices();
    const saved = savePatchFromTrack(track, "you", project, { name: "Custom" });

    const changed = new ProjectStore(false);
    changed.addCustomInstrument({ ...synth, label: "Edited Synth" });
    addFrom(changed, saved.id, "t-patch");

    expect(changed.customInstruments).toHaveLength(1);
    expect(changed.customInstruments[0].label).toBe("Edited Synth");
    expect((changed.getTrack("t-patch") as InstrumentTrack).instrumentType).toBe(synth.type);
  });

  it("replays the same: two projects in the same state end the same", () => {
    const { project, track } = madeWithDevices();
    const saved = savePatchFromTrack(track, "you", project, { name: "Custom" });
    const command = { ...patchTrackCommand(saved.id), id: "t-replay" } as EditCommand;
    const [left, right] = [new ProjectStore(false), new ProjectStore(false)];
    [left, right].forEach((store) => {
      store.addCustomInstrument({ ...synth, label: "Edited Synth" });
      applyEdit(store, command, "you");
    });
    expect(left.snapshot()).toEqual(right.snapshot());
  });

  it("keeps a device unchanged since it was last kept as one version", () => {
    const { project, track } = madeWithDevices();
    savePatchFromTrack(track, "you", project, { name: "One" });
    savePatchFromTrack(track, "you", project, { name: "Two" });
    expect(listPatches()).toHaveLength(2);
    expect(libraryEntry(synth.type)?.item.version).toBe(1);
    savePatchFromTrack(
      track,
      "you",
      { ...project, customInstruments: [{ ...synth, label: "Renamed" }], customEffects: [] },
      {},
    );
    expect(libraryEntry(synth.type)?.item.version).toBe(2);
  });

  it("tries a patch in Explore without displacing the project's own device of that type", () => {
    const { project, track } = madeWithDevices();
    const saved = savePatchFromTrack(track, "you", project, { name: "Custom" });
    const edited: CustomDevice = {
      ...synth,
      schema: [{ id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.3 }],
    };
    const open = new ProjectStore(false);
    open.addCustomInstrument(edited);
    const engine: PreviewEngine = {
      setPreview: () => undefined,
      getPreviewTarget: () => undefined,
      playSample: async () => null,
      stopSample: () => undefined,
      sampleDuration: async () => null,
    };
    const preview = new SoundPreview(engine, undefined, open);
    preview.open("patch", saved);

    expect(instrumentSchema(synth.type)[0].default).toBe(0.3); // still the project's
    const tried = preview.current()!;
    expect(tried.instrumentType).toBe(synth.type);
    expect(tried.devices?.instruments?.[0].schema[0].default).toBe(0.3);
  });

  it("keeps every device made or changed here in the library, and says what an update would reset", () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.onLocalEdit(keepDevicesOf);
    log.dispatch({ type: "addCustomInstrument", def: synth });
    expect(libraryDevice(synth.type)).toEqual(synth);

    const renamed: CustomDevice = {
      ...synth,
      schema: [{ id: "volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.8 }],
    };
    log.dispatch({ type: "updateCustomInstrument", def: renamed });
    expect(libraryEntry(synth.type)?.item.version).toBe(2);
    expect(settingsReset(synth, renamed)).toEqual(["Level"]);
    expect(settingsReset(synth, { ...synth, label: "Relabelled" })).toEqual([]);
  });
});
