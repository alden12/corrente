/**
 * The edges of a MIDI take: a key already down when the count-in ends, and a key still down when
 * the take stops after the loop has come round.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioEngine } from "../src/audio/engine/AudioEngine";
import { ProjectStore } from "../src/audio/project/projectStore";
import { Recorder } from "../src/audio/recording/recorder";
import type { Scheduler } from "../src/audio/sequencer/scheduler";
import type { Command } from "../src/audio/commands/types";

/** A transport at 120 BPM (two beats a second) over the project's loop, started at `playAt`. */
function setUp() {
  const clock = { now: 0 };
  const project = new ProjectStore();
  const transport = { playing: false, playAt: 0 };
  const unlooped = (time: number) => (transport.playing ? (time - transport.playAt) * 2 : 0);
  const scheduler = {
    get isPlaying() {
      return transport.playing;
    },
    play: (at?: number) => Object.assign(transport, { playing: true, playAt: at ?? clock.now }),
    stop: () => Object.assign(transport, { playing: false }),
    silence: () => {},
    unloopedBeatAtTime: unlooped,
    beatAtTime: (time: number) => unlooped(time) % project.length,
  };
  const engine = {
    started: true,
    get currentTime() {
      return clock.now;
    },
    scheduleClick: () => {},
  };
  const commands: Command[] = [];
  const recorder = new Recorder(
    engine as unknown as AudioEngine,
    scheduler as unknown as Scheduler,
    project,
    (command) => void commands.push(command),
  );
  /** Move the clock on, running the count-in's timer if it falls due. */
  const wait = (seconds: number) => {
    clock.now += seconds;
    vi.advanceTimersByTime(seconds * 1000);
  };
  const takeNotes = () => {
    const take = commands.find((command) => command.type === "addNoteClip");
    return take && "notes" in take ? take.notes : [];
  };
  return { recorder, project, wait, takeNotes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a MIDI take's edges", () => {
  it("starts a key pressed during the count-in, and still down, on the take's first beat", async () => {
    const { recorder, wait, takeNotes } = setUp();
    recorder.setCountInBars(1);
    await recorder.start();
    expect(recorder.getState().status).toBe("counting");
    recorder.noteOn(60, 0.7);
    recorder.noteOn(62); // pressed and let go during the count-in: not part of the take
    recorder.noteOff(62);
    wait(3); // past the count-in's bar and its lead
    expect(recorder.getState().status).toBe("recording");
    wait(0.5);
    recorder.noteOff(60);
    await recorder.stop();
    const notes = takeNotes();
    expect(notes.map((note) => note.pitch)).toEqual([60]);
    expect(notes[0].velocity).toBe(0.7);
    expect(notes[0].length).toBeGreaterThan(0.9);
  });

  it("keeps the length of a key held over the loop's end when the take stops", async () => {
    const { recorder, project, wait, takeNotes } = setUp();
    recorder.setCountInBars(0);
    await recorder.start();
    wait((project.length - 1) / 2); // a beat before the loop comes round
    recorder.noteOn(64);
    wait(1); // two beats: over the end of the loop
    await recorder.stop();
    const [note] = takeNotes();
    expect(note.length).toBeCloseTo(2, 5);
  });

  it("keeps the length of a key let go after the loop came round", async () => {
    const { recorder, project, wait, takeNotes } = setUp();
    recorder.setCountInBars(0);
    await recorder.start();
    wait((project.length - 1) / 2);
    recorder.noteOn(64);
    wait(1);
    recorder.noteOff(64);
    await recorder.stop();
    expect(takeNotes()[0].length).toBeCloseTo(2, 5);
  });
});
