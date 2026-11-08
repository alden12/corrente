/**
 * Automation clips in the project (DAW-67): the curve's shapes, the store's edits and coercion,
 * saving and loading, and the defaults a dispatch pins.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { clipValueAt, tidyPoints, valueAt } from "../src/audio/automation/curve";
import type { AutomationPoint } from "../src/audio/project/types";

const point = (beat: number, value: number, rest: Partial<AutomationPoint> = {}): AutomationPoint => ({
  id: `p${beat}`,
  beat,
  value,
  ...rest,
});

function fresh() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
  const track = () => project.getTrack("t-1")!;
  return { project, log, track };
}

describe("the curve", () => {
  it("holds its ends and runs straight between points", () => {
    const points = [point(1, 0.2), point(3, 0.6)];
    expect(valueAt(points, 0)).toBe(0.2);
    expect(valueAt(points, 2)).toBeCloseTo(0.4);
    expect(valueAt(points, 9)).toBe(0.6);
    expect(valueAt([], 2)).toBeUndefined();
  });

  it("bends a curve and holds a step", () => {
    const eased = [point(0, 0, { bend: 1 }), point(4, 1)];
    expect(valueAt(eased, 1)!).toBeGreaterThan(0.25);
    const easedIn = [point(0, 0, { bend: -1 }), point(4, 1)];
    expect(valueAt(easedIn, 1)!).toBeLessThan(0.25);
    expect(valueAt([point(0, 0.3, { shape: "step" }), point(4, 0.9)], 3.9)).toBe(0.3);
  });

  it("swings a wave around its line, every rate beats, within 0..1", () => {
    const sine = [point(0, 0.5, { shape: "sine", rate: 1, depth: 0.25 }), point(8, 0.5)];
    expect(valueAt(sine, 0.25)).toBeCloseTo(0.75);
    expect(valueAt(sine, 0.75)).toBeCloseTo(0.25);
    expect(valueAt(sine, 2.25)).toBeCloseTo(0.75);
    const square = [point(0, 0.9, { shape: "square", rate: 2, depth: 0.5 }), point(8, 0.9)];
    expect(valueAt(square, 0.5)).toBe(1);
    expect(valueAt(square, 1.5)).toBeCloseTo(0.4);
    const triangle = [point(0, 0.5, { shape: "triangle", rate: 4, depth: 0.5 }), point(8, 0.5)];
    expect(valueAt(triangle, 1)).toBeCloseTo(1);
    expect(valueAt(triangle, 3)).toBeCloseTo(0);
  });

  it("loops at the clip's length", () => {
    const clip = { lengthBeats: 4, points: [point(0, 0), point(4, 1)] };
    expect(clipValueAt(clip, 6)).toBeCloseTo(0.5);
  });

  it("tidies points into the clip, sorted, keeping a jump's order", () => {
    const tidied = tidyPoints([point(5, 2), { ...point(1, 0.5), id: "b" }, { ...point(1, -1), id: "a" }], 4);
    expect(tidied.map((tidy) => [tidy.id, tidy.beat, tidy.value])).toEqual([
      ["b", 1, 0.5],
      ["a", 1, 0],
      ["p5", 4, 1],
    ]);
  });
});

describe("automation clips in the project", () => {
  it("makes one with a pinned name and length, placed where asked", () => {
    const { log, track, project } = fresh();
    log.dispatch({ type: "addAutomation", trackId: "t-1", id: "au-1", placement: { id: "ap-1", startBeat: 4 } });
    const [clip] = track().automations;
    expect(clip.name).toBe("Automation");
    expect(clip.lengthBeats).toBe(project.newClipLength);
    expect(track().automationPlacements).toEqual([
      { id: "ap-1", clipId: "au-1", startBeat: 4, offset: 0, length: project.newClipLength },
    ]);
    const logged = log.getEntries().at(-1)!.command;
    expect(logged).toMatchObject({ name: "Automation", lengthBeats: project.newClipLength });
    log.dispatch({ type: "addAutomation", trackId: "t-1", id: "au-2" });
    expect(track().automations[1].name).toBe("Automation 2");
  });

  it("links to a note clip, taking that clip's length and no placement", () => {
    const { log, track } = fresh();
    const clipId = track().activeClipId;
    log.dispatch({ type: "setClipLength", trackId: "t-1", clipId, lengthBeats: 6 });
    log.dispatch({
      type: "addAutomation",
      trackId: "t-1",
      id: "au-1",
      linkedClipId: clipId,
      placement: { id: "ap-1", startBeat: 0 },
    });
    expect(track().automations[0]).toMatchObject({ linkedClipId: clipId, lengthBeats: 6 });
    expect(track().automationPlacements).toEqual([]);
  });

  it("is linked or placed, never both", () => {
    const { log, track } = fresh();
    const clipId = track().activeClipId;
    log.dispatch({ type: "addAutomation", trackId: "t-1", id: "au-1", placement: { id: "ap-1", startBeat: 0 } });
    log.dispatch({ type: "setAutomation", trackId: "t-1", automationId: "au-1", linkedClipId: clipId });
    expect(track().automationPlacements).toEqual([]);
    log.dispatch({ type: "placeAutomation", trackId: "t-1", id: "ap-2", automationId: "au-1", startBeat: 2 });
    expect(track().automations[0].linkedClipId).toBeUndefined();
    expect(track().automationPlacements).toHaveLength(1);
  });

  it("clamps what it is handed, and ignores an edit to nothing", () => {
    const { log, track } = fresh();
    log.dispatch({ type: "addAutomation", trackId: "t-1", id: "au-1", lengthBeats: 4 });
    log.dispatch({
      type: "setAutomation",
      trackId: "t-1",
      automationId: "au-1",
      points: [point(-2, 3), point(9, 0.5, { bend: 7, rate: 0, depth: -1 })],
    });
    expect(track().automations[0].points).toEqual([
      { ...point(0, 1), id: "p-2" },
      { ...point(4, 0.5), id: "p9", bend: 1, rate: 1 / 64, depth: 0 },
    ]);
    const before = JSON.stringify(track().automationPlacements);
    log.dispatch({ type: "setAutomationPlacement", trackId: "t-1", placementId: "nope", startBeat: 1 });
    expect(JSON.stringify(track().automationPlacements)).toBe(before);
    log.dispatch({ type: "placeAutomation", trackId: "t-1", id: "ap-1", automationId: "au-1", startBeat: -3 });
    expect(track().automationPlacements[0].startBeat).toBe(0);
  });

  it("removes a clip's placements with it, and unlinks from a note clip that goes", () => {
    const { log, track } = fresh();
    log.dispatch({ type: "addClip", trackId: "t-1", id: "c-2" });
    log.dispatch({ type: "addAutomation", trackId: "t-1", id: "au-1", linkedClipId: "c-2" });
    log.dispatch({ type: "addAutomation", trackId: "t-1", id: "au-2", placement: { id: "ap-1", startBeat: 0 } });
    log.dispatch({ type: "removeClip", trackId: "t-1", clipId: "c-2" });
    expect(track().automations.find((clip) => clip.id === "au-1")!.linkedClipId).toBeUndefined();
    log.dispatch({ type: "removeAutomation", trackId: "t-1", automationId: "au-2" });
    expect(track().automationPlacements).toEqual([]);
  });

  it("saves and loads, and a track without any writes none", () => {
    const { log, project } = fresh();
    expect(project.snapshot().tracks[0]).not.toHaveProperty("automations");
    log.dispatch({
      type: "addAutomation",
      trackId: "t-1",
      id: "au-1",
      points: [point(0, 0.1), point(2, 0.9, { shape: "saw", rate: 0.5 })],
      bindings: [{ id: "b-1", target: { kind: "effect", effectId: "fx-1" }, param: "mix", min: 0.4, max: 0 }],
      placement: { id: "ap-1", startBeat: 8 },
    });
    const saved = project.snapshot();
    const loaded = new ProjectStore(false);
    loaded.load(JSON.parse(JSON.stringify(saved)));
    expect(loaded.snapshot()).toEqual(saved);
    expect(loaded.getStructure().tracks[0].automations[0].bindings[0].max).toBe(0);
  });

  it("undoes as one step per edit, and a drag of points as one", () => {
    const { log, track } = fresh();
    log.dispatch({ type: "addAutomation", trackId: "t-1", id: "au-1", lengthBeats: 4 });
    for (const value of [0.2, 0.4, 0.6])
      log.dispatch({ type: "setAutomation", trackId: "t-1", automationId: "au-1", points: [point(0, value)] });
    expect(track().automations[0].points[0].value).toBe(0.6);
    log.undo();
    expect(track().automations[0].points).toEqual([]);
    log.undo();
    expect(track().automations).toEqual([]);
  });
});
