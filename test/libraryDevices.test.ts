import { beforeEach, describe, expect, it } from "vitest";
import type { CustomDevice } from "../src/audio/definitions/custom";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { applyEdit } from "../src/audio/commands/applyEdit";
import type { EditCommand } from "../src/audio/commands/types";
import { memoryBackend } from "../src/audio/library/backend";
import {
  libraryDevice,
  libraryDevices,
  offeredUpdate,
  settingsReset,
  withLibraryRef,
} from "../src/audio/library/devices";
import { EditLog } from "../src/audio/commands/editLog";
import { libraryEntry } from "../src/audio/library/store";
import { listPatches, openLibrary, savePatchFromTrack } from "../src/audio/patches/library";
import { patchTrackCommand } from "../src/audio/patches/patchTools";
import { SoundPreview, type PreviewEngine } from "../src/audio/live/preview";
import { instrumentSchema } from "../src/audio/instruments/catalog";
import { customEffect, customInstrument } from "./support/customDevices";

const synth = customInstrument("ci-lib00001", "Library Synth");
const gain = customEffect("ce-lib00001");

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
  applyEdit(project, { ...patchTrackCommand(patch, listPatches()), id } as EditCommand, "you");

describe("custom devices travel with patches (COMM-1.11.1)", () => {
  beforeEach(() => openLibrary(memoryBackend()));

  it("a patch carries the devices it plays, and keeps them in the library too", async () => {
    const { project, track } = madeWithDevices();
    const saved = await savePatchFromTrack(track, "you", project, { name: "Custom" });
    expect(saved.devices?.instruments?.map((device) => device.type)).toEqual([synth.type]);
    expect(saved.devices?.effects?.map((device) => device.type)).toEqual([gain.type]);
    expect(libraryDevices("instrument").map((device) => device.type)).toEqual([synth.type]);
    expect(libraryDevices("effect").map((device) => device.type)).toEqual([gain.type]);
  });

  it("brings them into a project that doesn't have them, and reuses ones it does", async () => {
    const { project, track } = madeWithDevices();
    const saved = await savePatchFromTrack(track, "you", project, { name: "Custom" });

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

  it("plays the project's own version where it already has the device, changing nothing it plays", async () => {
    const { project, track } = madeWithDevices();
    const saved = await savePatchFromTrack(track, "you", project, { name: "Custom" });

    const changed = new ProjectStore(false);
    changed.addCustomInstrument({ ...synth, label: "Edited Synth" });
    addFrom(changed, saved.id, "t-patch");

    expect(changed.customInstruments).toHaveLength(1);
    expect(changed.customInstruments[0].label).toBe("Edited Synth");
    expect((changed.getTrack("t-patch") as InstrumentTrack).instrumentType).toBe(synth.type);
  });

  it("replays the same: two projects in the same state end the same", async () => {
    const { project, track } = madeWithDevices();
    const saved = await savePatchFromTrack(track, "you", project, { name: "Custom" });
    const command = { ...patchTrackCommand(saved.id, listPatches()), id: "t-replay" } as EditCommand;
    const [left, right] = [new ProjectStore(false), new ProjectStore(false)];
    [left, right].forEach((store) => {
      store.addCustomInstrument({ ...synth, label: "Edited Synth" });
      applyEdit(store, command, "you");
    });
    expect(left.snapshot()).toEqual(right.snapshot());
  });

  it("keeps a device unchanged since it was last kept as one version", async () => {
    const { project, track } = madeWithDevices();
    await savePatchFromTrack(track, "you", project, { name: "One" });
    await savePatchFromTrack(track, "you", project, { name: "Two" });
    expect(listPatches()).toHaveLength(2);
    expect(libraryEntry(synth.type)?.item.version).toBe(1);
    await savePatchFromTrack(
      track,
      "you",
      { ...project, customInstruments: [{ ...synth, label: "Renamed" }], customEffects: [] },
      {},
    );
    expect(libraryEntry(synth.type)?.item.version).toBe(2);
  });

  it("tries a patch in Explore without displacing the project's own device of that type", async () => {
    const { project, track } = madeWithDevices();
    const saved = await savePatchFromTrack(track, "you", project, { name: "Custom" });
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

  it("keeps a device in the library before its edit lands, and the project says which version it has", async () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const land = async (command: EditCommand) => log.dispatch(await withLibraryRef(command, "you"));
    await land({ type: "addCustomInstrument", def: synth });
    expect(libraryDevice(synth.type)).toEqual(synth);
    const first = project.deviceRef(synth.type);
    expect(first).toEqual({ version: 1, hash: libraryEntry(synth.type)?.current.hash });

    const renamed: CustomDevice = {
      ...synth,
      schema: [{ id: "volume", label: "Volume", kind: "number", min: 0, max: 1, default: 0.8 }],
    };
    await land({ type: "updateCustomInstrument", def: renamed });
    expect(project.deviceRef(synth.type)?.version).toBe(2);
    expect(project.snapshot().deviceLibrary?.[synth.type]?.version).toBe(2);

    // Undo puts the project back on version 1; the library keeps version 2.
    log.undo();
    expect(project.deviceRef(synth.type)).toEqual(first);
    expect(libraryEntry(synth.type)?.item.version).toBe(2);
    expect(settingsReset(synth, renamed)).toEqual(["Level"]);
    expect(settingsReset(synth, { ...synth, label: "Relabelled" })).toEqual([]);
  });

  it("won't make a device edit ready when the library can't keep the device", async () => {
    await openLibrary({
      load: async () => ({ items: [], current: [] }),
      save: () => Promise.reject(new Error("the library is full")),
    });
    await expect(withLibraryRef({ type: "addCustomInstrument", def: synth }, "you")).rejects.toThrow(
      "the library is full",
    );
  });

  it("offers an update only to a newer version: never one the project is ahead of", () => {
    const louder: CustomDevice = { ...synth, label: "Louder" };
    const entry = (version: number, document: CustomDevice, hiddenAt?: number) => ({
      item: {
        id: synth.type,
        kind: "instrument" as const,
        name: "Synth",
        version,
        createdAt: 1,
        updatedAt: 1,
        ...(hiddenAt ? { hiddenAt } : {}),
      },
      current: {
        itemId: synth.type,
        version,
        createdAt: 1,
        author: "you",
        tags: [],
        document,
        hash: `hash-${version}`,
      },
    });
    // The project's on version 1; the library has 2: offered.
    expect(offeredUpdate(entry(2, louder), synth, { version: 1, hash: "hash-1" })).toEqual(louder);
    // The same version, or the library behind the project (an agent's edit not yet synced here): not.
    expect(offeredUpdate(entry(1, synth), synth, { version: 1, hash: "hash-1" })).toBeUndefined();
    expect(offeredUpdate(entry(4, synth), louder, { version: 5, hash: "hash-5" })).toBeUndefined();
    // Deleted from the library: not.
    expect(offeredUpdate(entry(2, louder, 9), synth, { version: 1, hash: "hash-1" })).toBeUndefined();
    // A project from before references: by content.
    expect(offeredUpdate(entry(2, louder), synth, undefined)).toEqual(louder);
    expect(offeredUpdate(entry(2, synth), synth, undefined)).toBeUndefined();
  });

  it("keeps an identical device as the version it already is", async () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.dispatch(await withLibraryRef({ type: "addCustomInstrument", def: synth }, "you"));
    log.dispatch(await withLibraryRef({ type: "updateCustomInstrument", def: { ...synth } }, "you"));
    expect(libraryEntry(synth.type)?.item.version).toBe(1);
    expect(project.deviceRef(synth.type)?.version).toBe(1);
  });
});
