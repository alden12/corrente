/**
 * A new track's starter clip (DAW-50, DAW-92): it starts off the timeline, its first notes place it,
 * and a take recorded before anything was written replaces it. Older log entries replay as they did.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { applyEdit } from "../src/audio/commands/applyEdit";
import type { InstrumentTrack } from "../src/audio/project/projectStore";

const note = (id: string) => ({ id, start: 0, length: 1, pitch: 60, velocity: 100 });

function fresh() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
  const track = () => project.getTrack("t-1") as InstrumentTrack;
  return { project, log, track };
}

const take = { kind: "instrument" as const, name: "Take 1", notes: [note("n-take")], lengthBeats: 4 };

describe("a new track's starter clip", () => {
  it("starts off the timeline, and the logged command says so", () => {
    const { log, track } = fresh();
    expect(track().placements).toEqual([]);
    expect(log.getEntries().at(-1)?.command).toMatchObject({ type: "createTrack", unplaced: true });
  });

  it("an older createTrack, which said nothing, still places it", () => {
    const project = new ProjectStore(false);
    applyEdit(project, { type: "createTrack", instrumentType: "subtractive", id: "t-1" }, "you");
    expect(project.getTrack("t-1")?.placements).toHaveLength(1);
  });

  it("its first notes place it at the loop's start, in the same undo step", () => {
    const { project, log, track } = fresh();
    project.setLoopStart(8);
    log.dispatch({ type: "addNotes", trackId: "t-1", notes: [note("n-1")] });
    expect(log.getEntries().at(-1)?.command).toMatchObject({ placeAt: 8 });
    expect(track().placements).toMatchObject([{ id: "p-t-1", clipId: "c-t-1", startBeat: 8 }]);

    log.undo();
    expect(track().placements).toEqual([]);
    expect(project.getClipStore("t-1", "c-t-1")?.getClip().notes).toEqual([]);
  });

  it("later notes don't place it again", () => {
    const { log, track } = fresh();
    log.dispatch({ type: "addNote", trackId: "t-1", note: note("n-1") });
    log.dispatch({ type: "addNote", trackId: "t-1", note: note("n-2") });
    expect(log.getEntries().at(-1)?.command).not.toHaveProperty("placeAt");
    expect(track().placements).toHaveLength(1);
  });

  it("notes into a launched clip leave the timeline alone", () => {
    const { log, track } = fresh();
    log.dispatch({ type: "launchClip", trackId: "t-1", clipId: "c-t-1" });
    log.dispatch({ type: "addNote", trackId: "t-1", note: note("n-1") });
    expect(track().placements).toEqual([]);
  });
});

describe("a take on a fresh track", () => {
  it("replaces the untouched starter clip, and one undo brings it back", () => {
    const { project, log, track } = fresh();
    const replaces = project.untouchedStarter("t-1");
    expect(replaces).toBe("c-t-1");
    log.dispatch({ type: "pasteClip", trackId: "t-1", id: "c-take", content: take, recorded: true, replaces });
    expect(track().clips.map((clip) => clip.id)).toEqual(["c-take"]);

    log.undo();
    expect(track().clips.map((clip) => clip.id)).toEqual(["c-t-1"]);
  });

  it("removes an older track's starter placement with it", () => {
    const project = new ProjectStore(false);
    applyEdit(project, { type: "createTrack", instrumentType: "subtractive", id: "t-1" }, "you");
    const replaces = project.untouchedStarter("t-1");
    applyEdit(project, { type: "pasteClip", trackId: "t-1", id: "c-take", content: take, replaces }, "you");
    expect(project.getTrack("t-1")?.placements).toEqual([]);
  });

  it("keeps a starter clip someone has written in, renamed or coloured", () => {
    const touched = [
      { type: "addNote", trackId: "t-1", note: note("n-1") },
      { type: "renameClip", trackId: "t-1", clipId: "c-t-1", name: "Intro" },
      { type: "setClipColor", trackId: "t-1", clipId: "c-t-1", color: "red" },
    ] as const;
    for (const command of touched) {
      const { project, log } = fresh();
      log.dispatch(command);
      expect(project.untouchedStarter("t-1")).toBeUndefined();
    }
  });

  it("keeps it when it is not the track's only clip", () => {
    const { project, log } = fresh();
    log.dispatch({ type: "addClip", trackId: "t-1", id: "c-2", empty: true });
    expect(project.untouchedStarter("t-1")).toBeUndefined();
  });

  it("keeps it if notes reached it before the take landed", () => {
    const { project, track } = fresh();
    applyEdit(project, { type: "addNote", trackId: "t-1", clipId: "c-t-1", note: note("n-1") }, "you");
    applyEdit(project, { type: "pasteClip", trackId: "t-1", id: "c-take", content: take, replaces: "c-t-1" }, "you");
    expect(track().clips.map((clip) => clip.id)).toEqual(["c-t-1", "c-take"]);
  });
});
