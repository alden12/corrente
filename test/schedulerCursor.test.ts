import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../src/audio/sequencer/scheduler";
import { musicalBeat } from "../src/audio/sequencer/timing";
import { ProjectStore } from "../src/audio/project/projectStore";

/**
 * The cursor (DAW-31): play starts from it, stop comes back to it, and one before the loop's start
 * plays a lead-in into the loop. A 16-beat project at 120 BPM (two beats a second), one note per
 * pitch at the beat it names, and a clock to run.
 */
function setUp(noteBeats: number[]) {
  const clock = { now: 0 };
  const played: { pitch: number; when: number }[] = [];
  const toldBeats: number[] = [];
  const engine = {
    started: true,
    get currentTime() {
      return clock.now;
    },
    getNoteTarget: () => ({
      playNote: (pitch: number, _seconds: number, _velocity: number, when: number) => played.push({ pitch, when }),
      allNotesOff: () => {},
    }),
    scheduleAudioClip: () => {},
    stopAllAudio: () => {},
    setTransport: ({ beat }: { beat: number }) => toldBeats.push(beat),
  };
  const project = new ProjectStore(false);
  project.setTempo(120);
  project.setLength(16);
  const track = project.addTrack("subtractive");
  const clip = project.getClipStore(track.id)!;
  clip.setLength(16);
  noteBeats.forEach((beat) => clip.addNote({ pitch: 60 + beat, start: beat, length: 0.5 }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduler = new Scheduler(engine as any, project);
  const run = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.025) {
      clock.now += 0.025;
      vi.advanceTimersByTime(25);
    }
  };
  /** The beats each note played at, from the clock's time when play started. */
  const beatsPlayed = (from: number) => played.map(({ pitch, when }) => [pitch - 60, (when - from) * 2]);
  return { scheduler, project, played, toldBeats, run, clock, beatsPlayed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the cursor", () => {
  it("is where play starts, and play comes round to the loop's start", () => {
    const { scheduler, run, beatsPlayed } = setUp([0, 4, 8]);
    scheduler.setCursor(4);
    scheduler.play();
    run(7); // 14 beats: from 4 to the end (12 beats), round, and on past 0
    scheduler.stop();
    expect(beatsPlayed(0).map(([note, at]) => [note, Math.round(at)])).toEqual([
      [4, 0],
      [8, 4],
      [0, 12],
    ]);
  });

  it("is where play starts again after a stop", () => {
    const { scheduler, run, clock, played, beatsPlayed } = setUp([4]);
    scheduler.setCursor(4);
    scheduler.play();
    run(1);
    scheduler.stop();
    played.length = 0;
    const restart = clock.now;
    scheduler.play();
    run(0.2);
    scheduler.stop();
    expect(beatsPlayed(restart).map(([note, at]) => [note, Math.round(at)])).toEqual([[4, 0]]);
  });

  it("before the loop's start plays a lead-in into the loop, then loops the loop", () => {
    const { scheduler, project, run, beatsPlayed } = setUp([0, 4, 6, 8]);
    project.setLoopStart(8);
    scheduler.setCursor(4);
    scheduler.play();
    run(6); // 12 beats: the lead-in's 4, the loop's 8, and round to its start
    scheduler.stop();
    expect(beatsPlayed(0).map(([note, at]) => [note, Math.round(at)])).toEqual([
      [4, 0],
      [6, 2],
      [8, 4],
      [8, 12],
    ]);
  });

  it("before the loop, with looping off, plays on to the end rather than stopping at the loop", () => {
    const { scheduler, project, run } = setUp([8]);
    project.setLoopStart(8);
    scheduler.setLooping(false);
    scheduler.setCursor(4);
    scheduler.play();
    run(5); // 10 beats: past the loop's start, short of the end
    expect(scheduler.isPlaying).toBe(true);
    run(2); // past the end
    expect(scheduler.isPlaying).toBe(false);
  });

  it("keeps the beat the engine is told above 0 during a lead-in, on a whole bar", () => {
    const { scheduler, project, toldBeats } = setUp([]);
    project.setLoopStart(8);
    scheduler.setCursor(3);
    scheduler.play();
    scheduler.stop();
    // Five beats before the loop, so two bars are added: the engine hears beat 3 of its count.
    expect(toldBeats[0]).toBe(3);
  });

  it("moved while playing, play jumps there", () => {
    const { scheduler, run, clock, played, beatsPlayed } = setUp([2, 10]);
    scheduler.play();
    run(0.5);
    played.length = 0;
    const jumped = clock.now;
    scheduler.setCursor(10);
    run(0.2);
    scheduler.stop();
    expect(beatsPlayed(jumped).map(([note, at]) => [note, Math.round(at)])).toEqual([[10, 0]]);
  });

  it("cleared, play starts at the loop's start again", () => {
    const { scheduler, run, beatsPlayed } = setUp([0, 4]);
    scheduler.setCursor(4);
    scheduler.setCursor(null);
    scheduler.play();
    run(0.2);
    scheduler.stop();
    expect(beatsPlayed(0).map(([note]) => note)).toEqual([0]);
  });
});

describe("musicalBeat", () => {
  it("comes round the loop, and counts a lead-in straight from before the loop's start", () => {
    expect(musicalBeat(3, 8, 8)).toBe(11);
    expect(musicalBeat(10, 8, 8)).toBe(10);
    expect(musicalBeat(-4, 8, 8)).toBe(4);
  });
});
