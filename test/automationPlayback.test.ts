/**
 * Automation playing (DAW-67.2): where a track's automation runs, the moves it sends, a grabbed knob
 * overriding it until the next play, and a bounce honouring it.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { automationMoves, automationRuns, knobValuesAt, type AutomatedTrack } from "../src/audio/automation/playback";
import { AutomationPlayer, type AutomationEngine } from "../src/audio/automation/player";
import { renderProject } from "../src/audio/render/renderProject";
import { nodeRenderSetup } from "../server/render/nodeRender";
import { EventQueue, EVENT } from "../src/audio/bank/events";
import type { AutomationBinding, AutomationClipData, Placement } from "../src/audio/project/types";
import type { ParamStore } from "../src/audio/params/store";

const LEVEL: AutomationBinding = { id: "b-1", target: { kind: "instrument" }, param: "amp.level", min: 0, max: 1 };

/** A clip ramping 0 to 1 over its four beats. */
const ramp = (id: string, rest: Partial<AutomationClipData> = {}): AutomationClipData => ({
  id,
  name: id,
  author: "you",
  lengthBeats: 4,
  points: [
    { id: `${id}-a`, beat: 0, value: 0 },
    { id: `${id}-b`, beat: 4, value: 1 },
  ],
  bindings: [LEVEL],
  ...rest,
});

const placed = (clipId: string, startBeat: number, length = 4, offset = 0): Placement => ({
  id: `p-${clipId}-${startBeat}`,
  clipId,
  startBeat,
  offset,
  length,
});

const track = (rest: Partial<AutomatedTrack>): AutomatedTrack => ({
  automations: [],
  automationPlacements: [],
  placements: [],
  launchedClipId: null,
  ...rest,
});

describe("where automation runs", () => {
  it("plays an unlinked clip at its placements, the later-starting winning an overlap", () => {
    const runs = automationRuns(
      track({
        automations: [ramp("a"), ramp("b", { points: [{ id: "x", beat: 0, value: 0.5 }] })],
        automationPlacements: [placed("a", 0, 8), placed("b", 2, 2)],
      }),
      0,
      16,
    );
    expect(knobValuesAt(runs, 1).get("instrument::amp.level")?.value).toBeCloseTo(0.25);
    expect(knobValuesAt(runs, 3).get("instrument::amp.level")?.value).toBe(0.5);
    // Past its own length the clip loops in its placement.
    expect(knobValuesAt(runs, 5).get("instrument::amp.level")?.value).toBeCloseTo(0.25);
    expect(knobValuesAt(runs, 9).size).toBe(0);
  });

  it("plays a linked clip wherever its note clip plays, spanning that clip's loops", () => {
    const runs = automationRuns(
      track({
        automations: [
          ramp("a", {
            linkedClipId: "c-1",
            lengthBeats: 8,
            points: [
              { id: "x", beat: 0, value: 0 },
              { id: "y", beat: 8, value: 1 },
            ],
          }),
        ],
        placements: [placed("c-1", 4, 8)],
      }),
      0,
      16,
    );
    expect(knobValuesAt(runs, 2).size).toBe(0);
    // Two beats into an eight-beat placement of a (shorter) note clip: a quarter of the way.
    expect(knobValuesAt(runs, 6).get("instrument::amp.level")?.value).toBeCloseTo(0.25);
    expect(knobValuesAt(runs, 10).get("instrument::amp.level")?.value).toBeCloseTo(0.75);
  });

  it("follows a launched clip over the loop, and rests the arrangement's own automation", () => {
    const runs = automationRuns(
      track({
        automations: [ramp("linked", { linkedClipId: "c-1" }), ramp("free")],
        automationPlacements: [placed("free", 0)],
        launchedClipId: "c-1",
      }),
      2,
      8,
    );
    expect(runs.map((run) => [run.clip.id, run.startBeat, run.length])).toEqual([["linked", 2, 8]]);
  });

  it("samples each window on one grid, so windows carry on without a gap or a repeat", () => {
    const runs = automationRuns(track({ automations: [ramp("a")], automationPlacements: [placed("a", 0)] }), 0, 4);
    const first = automationMoves(runs, 0, 0.1, 0, 4, 0.01).map((move) => move.beat);
    const second = automationMoves(runs, 0.1, 0.2, 0, 4, 0.01).map((move) => move.beat);
    expect(first).toHaveLength(10);
    expect(second[0]).toBeCloseTo(0.1);
    expect(second).toHaveLength(10);
  });
});

/** An engine that writes down what automation asks of it. */
const fakeEngine = () => {
  const calls: { kind: "automate" | "release"; id: string; value?: number; time: number }[] = [];
  const engine: AutomationEngine & { calls: typeof calls; currentTime: number } = {
    calls,
    currentTime: 0,
    automate: (_track: string, _store: ParamStore, id: string, value: number, time: number) =>
      void calls.push({ kind: "automate", id, value, time }),
    releaseAutomation: (_track: string, _store: ParamStore, id: string, time: number) =>
      void calls.push({ kind: "release", id, time }),
  };
  return engine;
};

const automatedProject = () => {
  const project = new ProjectStore(false);
  const instrument = project.addTrack("subtractive") as InstrumentTrack;
  project.addAutomation(instrument.id, {
    id: "au-1",
    name: "Fade",
    lengthBeats: 4,
    points: ramp("x").points,
    bindings: [LEVEL],
    placement: { id: "ap-1", startBeat: 0 },
  });
  return { project, instrument };
};

const window = (fromBeat: number, toBeat: number) => ({
  fromBeat,
  toBeat,
  loopStart: 0,
  loopLength: 4,
  beatsPerSecond: 2,
  timeAt: (beat: number) => beat / 2,
});

describe("the automation player", () => {
  it("moves the knob on the engine without editing it, and puts it back at the stop", () => {
    const { project, instrument } = automatedProject();
    const engine = fakeEngine();
    const player = new AutomationPlayer(engine, project);
    player.begin();
    player.schedule(window(2, 2.05), () => false);
    const moves = engine.calls.filter((call) => call.kind === "automate");
    expect(moves.length).toBe(5);
    expect(moves[0]).toMatchObject({ id: "amp.level", time: 1 });
    expect(moves[0].value).toBeCloseTo(0.5);
    expect(instrument.params.get("amp.level")).toBe(0.8);
    player.end();
    expect(engine.calls.at(-1)).toMatchObject({ kind: "release", id: "amp.level" });
  });

  it("skips the tracks it is told to (muted, or the one a take records into)", () => {
    const { project } = automatedProject();
    const engine = fakeEngine();
    new AutomationPlayer(engine, project).schedule(window(0, 1), () => true);
    expect(engine.calls).toEqual([]);
  });

  it("leaves a grabbed knob to whoever grabbed it until the next play, or Back to automation", () => {
    const { project, instrument } = automatedProject();
    const engine = fakeEngine();
    const player = new AutomationPlayer(engine, project);
    let heard = 0;
    player.subscribe(() => heard++);
    player.begin();
    player.schedule(window(0, 0.5), () => false);
    instrument.params.set("amp.level", 0.3);
    expect(engine.calls.at(-1)).toMatchObject({ kind: "release", id: "amp.level" });
    expect(player.isOverridden(instrument.id, LEVEL)).toBe(true);
    expect(player.overriddenCount).toBe(1);
    expect(heard).toBe(1);
    const before = engine.calls.length;
    player.schedule(window(0.5, 1), () => false);
    expect(engine.calls.length).toBe(before);

    player.backToAutomation();
    expect(player.isOverridden(instrument.id, LEVEL)).toBe(false);
    player.schedule(window(1, 1.5), () => false);
    expect(engine.calls.length).toBeGreaterThan(before);

    instrument.params.set("amp.level", 0.4);
    player.end();
    player.begin();
    expect(player.overriddenCount).toBe(0);
    expect(heard).toBe(4);
  });
});

describe("the bank's queue", () => {
  it("drops one param's queued moves from a time on, keeping the rest", () => {
    const queue = new EventQueue();
    queue.add(EVENT.param, 0, 1, 0.1, 1);
    queue.add(EVENT.param, 0, 1, 0.2, 2);
    queue.add(EVENT.param, 0, 2, 0.3, 2);
    queue.add(EVENT.param, 1, 1, 0.4, 2);
    queue.add(EVENT.noteOn, 0, 60, 1, 2);
    queue.clearParam(0, 1, 1.5);
    const left: number[] = [];
    for (let event = queue.next(Infinity); event; event = queue.next(Infinity)) left.push(event.value);
    expect(left).toEqual([0.1, 0.3, 0.4, 1]);
  });
});

describe("a bounce", () => {
  it("plays the automation: a level ramped up from silence starts quiet and ends loud", async () => {
    const project = new ProjectStore(false);
    project.setTempo(120);
    project.setLength(4);
    const instrument = project.addTrack("subtractive") as InstrumentTrack;
    instrument.clips[0].store.addNote({ pitch: 60, start: 0, length: 4, velocity: 0.8 });
    project.placeClip(instrument.id, instrument.clips[0].id, 0);
    const loud = await renderProject(project, nodeRenderSetup(), { tailSec: 0 });
    project.addAutomation(instrument.id, {
      id: "au-1",
      name: "Fade in",
      lengthBeats: 4,
      points: ramp("x").points,
      bindings: [LEVEL],
      placement: { id: "ap-1", startBeat: 0 },
    });
    const faded = await renderProject(project, nodeRenderSetup(), { tailSec: 0 });
    const peak = (channel: Float32Array, from: number, to: number) =>
      channel.subarray(from, to).reduce((most, sample) => Math.max(most, Math.abs(sample)), 0);
    const rate = faded.sampleRate;
    // A quarter second in (past the knob's own value, which the first move ramps away from over its
    // smoothing) against the last quarter, beside the same notes unautomated at the knob's 0.8.
    const early = peak(faded.channels[0], rate / 4, rate / 2);
    const late = peak(faded.channels[0], rate * 1.75, rate * 2);
    expect(early).toBeLessThan(0.35 * late);
    expect(late).toBeGreaterThan(peak(loud.channels[0], rate * 1.75, rate * 2));
  });
});
