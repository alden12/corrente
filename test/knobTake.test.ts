/** Knob moves recorded as automation (DAW-67.7): one clip per knob moved, thinned, from the take's start. */
import { describe, expect, it } from "vitest";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { KnobTake, thin } from "../src/audio/automation/knobTake";
import type { Recorder, RecorderState } from "../src/audio/recording/recorder";
import { createListeners } from "../src/listeners";

/** A recorder whose status the test sets, and a clock at 2 beats a second the test moves. */
function rig() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
  const track = project.getTrack("t-1") as InstrumentTrack;
  const listeners = createListeners();
  let status: RecorderState["status"] = "idle";
  const recorder = {
    subscribe: listeners.subscribe,
    getState: () => ({ status, armedTrackId: null }) as unknown as RecorderState,
  } as unknown as Recorder;
  const clock = {
    currentTime: 10,
    continuousBeatAtTime: (time: number) => time * 2,
    beatAtTime: (time: number) => time * 2 - 12,
  };
  const stop = new KnobTake(recorder, clock, project, log.dispatch).start();
  const setStatus = (next: RecorderState["status"]) => {
    status = next;
    listeners.emit();
  };
  return { project, log, track, clock, setStatus, stop };
}

describe("a knob take", () => {
  it("lands each knob moved as a clip bound to it, from the take's start to its end", () => {
    const { track, clock, setStatus } = rig();
    const before = Number(track.params.get("amp.level"));
    setStatus("recording");
    clock.currentTime = 10.5;
    track.params.set("amp.level", 0.2);
    clock.currentTime = 11;
    track.params.set("amp.level", 0.6);
    clock.currentTime = 12;
    setStatus("idle");

    expect(track.automations).toHaveLength(1);
    const [clip] = track.automations;
    expect(clip.name).toBe("Level take");
    expect(clip.lengthBeats).toBe(4);
    expect(clip.bindings[0]).toMatchObject({ target: { kind: "instrument" }, param: "amp.level", min: 0, max: 1 });
    expect(clip.points.map((point) => [point.beat, Number(point.value.toFixed(2))])).toEqual([
      [0, before],
      [1, 0.2],
      [2, 0.6],
      [4, 0.6],
    ]);
    expect(track.automationPlacements[0]).toMatchObject({ startBeat: 8, length: 4 });
  });

  it("lands nothing for a take with no knob moved, and stops listening once stopped", () => {
    const { track, setStatus, stop } = rig();
    setStatus("recording");
    setStatus("idle");
    expect(track.automations).toEqual([]);
    stop();
    setStatus("recording");
    track.params.set("amp.level", 0.1);
    setStatus("idle");
    expect(track.automations).toEqual([]);
  });

  it("thins points a straight line would draw anyway", () => {
    const ramp = Array.from({ length: 11 }, (_, index) => ({ beat: index, value: index / 10 }));
    expect(thin(ramp)).toEqual([ramp[0], ramp[10]]);
    const corner = [...ramp.slice(0, 6), { beat: 6, value: 0.2 }];
    expect(thin(corner).map((point) => point.beat)).toEqual([0, 5, 6]);
  });
});
