import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../src/audio/sequencer/scheduler";
import { ProjectStore } from "../src/audio/project/projectStore";

/** A 4-bar project at 120 BPM (two beats a second) with one note on beat 0, and a clock to run. */
function setUp() {
  const clock = { now: 0 };
  const played: number[] = [];
  const engine = {
    started: true,
    get currentTime() {
      return clock.now;
    },
    getNoteTarget: () => ({
      playNote: (_pitch: number, _seconds: number, _velocity: number, when: number) => played.push(when),
      allNotesOff: () => {},
    }),
    scheduleAudioClip: () => {},
    stopAllAudio: () => {},
    setTransport: () => {},
  };
  const project = new ProjectStore(false);
  project.setTempo(120);
  const track = project.addTrack("subtractive");
  project.getClipStore(track.id)!.addNote({ pitch: 60, start: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduler = new Scheduler(engine as any, project);
  const run = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.025) {
      clock.now += 0.025;
      vi.advanceTimersByTime(25);
    }
  };
  return { scheduler, played, run };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the loop switch", () => {
  it("comes round while looping, as before", () => {
    const { scheduler, played, run } = setUp();
    scheduler.play();
    run(17); // over two passes of 8 seconds
    expect(played.length).toBeGreaterThanOrEqual(3);
    expect(scheduler.isPlaying).toBe(true);
    scheduler.stop();
  });

  it("off, plays once and stops at the end", () => {
    const { scheduler, played, run } = setUp();
    scheduler.setLooping(false);
    scheduler.play();
    run(10);
    expect(played).toHaveLength(1);
    expect(scheduler.isPlaying).toBe(false);
  });

  it("turned off mid-play, finishes the pass it's in", () => {
    const { scheduler, played, run } = setUp();
    scheduler.play();
    run(9); // into the second pass
    scheduler.setLooping(false);
    expect(scheduler.isPlaying).toBe(true);
    run(8);
    expect(played).toHaveLength(2);
    expect(scheduler.isPlaying).toBe(false);
  });

  it("hands the end to its handler when there is one (a take finishes itself)", () => {
    const { scheduler, run } = setUp();
    const reachedEnd = vi.fn(() => scheduler.stop());
    scheduler.setOnReachedEnd(reachedEnd);
    scheduler.setLooping(false);
    scheduler.play();
    run(10);
    expect(reachedEnd).toHaveBeenCalledTimes(1);
  });
});
