import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { previewTrackId } from "../src/audio/project/previewTrack";
import type { EditCommand } from "../src/audio/commands/types";

/** Each person's preview as a track of the project (COMM-1.4.5). */

const tryOn = (owner: string, instrumentType = "subtractive", name = "Subtractive"): EditCommand => ({
  type: "setPreview",
  owner,
  name,
  instrumentType,
  params: {},
  effects: [],
});

describe("a person's preview track", () => {
  it("is found by id, but not listed with the tracks", () => {
    const store = new ProjectStore(false);
    const log = new EditLog(store);
    log.dispatch(tryOn("ana"));

    const id = previewTrackId("ana");
    expect(store.getTrack(id)?.kind).toBe("instrument");
    expect(store.getPreview("ana")?.name).toBe("Subtractive");
    expect(store.getTracks().map((track) => track.id)).not.toContain(id);
    expect(store.getStructure().tracks.map((track) => track.id)).not.toContain(id);
  });

  it("takes device edits as any track does, and undoes them in the project's history", () => {
    const store = new ProjectStore(false);
    const log = new EditLog(store);
    log.dispatch(tryOn("ana"));
    const id = previewTrackId("ana");
    log.dispatch({ type: "addEffect", hostId: id, effectType: "reverb", id: "fx-1" });
    expect(store.getPreview("ana")?.effects.map((effect) => effect.type)).toEqual(["reverb"]);

    log.undo();
    expect(store.getPreview("ana")?.effects).toEqual([]);
    log.undo();
    expect(store.getPreview("ana")).toBeUndefined();
  });

  it("is re-sounded in place by another try, keeping its id", () => {
    const store = new ProjectStore(false);
    const log = new EditLog(store);
    log.dispatch(tryOn("ana"));
    log.dispatch(tryOn("ana", "fm", "FM"));

    expect(store.getPreviews()).toHaveLength(1);
    expect(store.getPreview("ana")?.instrumentType).toBe("fm");
    expect(store.getPreview("ana")?.name).toBe("FM");
  });

  it("is one per person", () => {
    const store = new ProjectStore(false);
    const log = new EditLog(store);
    log.dispatch(tryOn("ana"));
    log.dispatch(tryOn("ben", "fm", "FM"));
    log.dispatch({ type: "removePreview", owner: "ana" });

    expect(store.getPreviews().map((preview) => preview.id)).toEqual([previewTrackId("ben")]);
  });

  it("is saved with the project, and a project without any saves as it did", () => {
    const store = new ProjectStore(false);
    expect(store.snapshot()).not.toHaveProperty("previews");

    const log = new EditLog(store);
    log.dispatch(tryOn("ana"));
    log.dispatch({ type: "addEffect", hostId: previewTrackId("ana"), effectType: "reverb", id: "fx-1" });
    const reloaded = new ProjectStore(false);
    reloaded.load(store.snapshot());

    expect(reloaded.getPreview("ana")?.effects.map((effect) => effect.type)).toEqual(["reverb"]);
    expect(reloaded.getTracks().map((track) => track.id)).not.toContain(previewTrackId("ana"));
  });

  it("put away while you're looking at it, leaves you on a track", () => {
    const store = new ProjectStore(false);
    const log = new EditLog(store);
    log.dispatch({ type: "createTrack", id: "t1", instrumentType: "subtractive" });
    log.dispatch(tryOn("ana"));
    store.selectTrack(previewTrackId("ana"));
    log.dispatch({ type: "removePreview", owner: "ana" });

    expect(store.selectedId).toBe("t1");
  });
});
