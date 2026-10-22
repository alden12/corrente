/**
 * The edges of a MIDI take: a key already down when the count-in ends, and a key still down when
 * the take stops after the loop has come round. And how it ends (DAW-79): by itself after one pass,
 * landing as a new clip that's launched, the arrangement left alone.
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
  let cue: { beat: number; handler: () => void } | null = null;
  const unlooped = (time: number) => (transport.playing ? (time - transport.playAt) * 2 : 0);
  const scheduler = {
    get isPlaying() {
      return transport.playing;
    },
    play: (at?: number) => Object.assign(transport, { playing: true, playAt: at ?? clock.now }),
    stop: () => Object.assign(transport, { playing: false }),
    silence: () => {},
    cueAt: (beat: number, handler: () => void) => void (cue = { beat, handler }),
    cancelCue: () => void (cue = null),
    continuousBeatAtTime: unlooped,
    beatAtTime: (time: number) => unlooped(time) % project.length,
  };
  const engine = {
    started: true,
    get currentTime() {
      return clock.now;
    },
    scheduleClick: () => {},
    disableInput: () => {},
  };
  const commands: Command[] = [];
  const recorder = new Recorder(
    engine as unknown as AudioEngine,
    scheduler as unknown as Scheduler,
    project,
    (command) => void commands.push(command),
  );
  /** Move the clock on, running the count-in's timer and the cue if they fall due. */
  const wait = (seconds: number) => {
    clock.now += seconds;
    vi.advanceTimersByTime(seconds * 1000);
    if (cue && unlooped(clock.now) >= cue.beat) {
      const { handler } = cue;
      cue = null;
      handler();
    }
  };
  const take = () => {
    const command = commands.find((each) => each.type === "pasteClip");
    return command?.type === "pasteClip" && command.content.kind === "instrument" ? command.content : undefined;
  };
  const takeNotes = () => take()?.notes ?? [];
  return { recorder, project, transport, commands, wait, take, takeNotes };
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

  it("ends a key held over the loop's end at the end, rather than as a sliver, and keeps the clip to the loop", async () => {
    const { recorder, project, wait, take, takeNotes } = setUp();
    recorder.setCountInBars(0);
    await recorder.start();
    wait((project.length - 1) / 2); // a beat before the loop comes round
    recorder.noteOn(64);
    wait(1); // two beats: over the end of the loop
    await recorder.stop();
    const [note] = takeNotes();
    expect(note.start + note.length).toBeCloseTo(project.length, 5);
    expect(take()?.lengthBeats).toBe(project.length);
  });

  it("keeps a take that starts a hair early to the loop: a key held from the count-in to after the end", async () => {
    const { recorder, project, wait, take } = setUp();
    recorder.setCountInBars(1);
    await recorder.start();
    recorder.noteOn(60);
    // The count-in's timer fires with the audio clock still 1ms short of its downbeat (a bar at
    // 120 plus the 0.12s lead), as a timer can.
    wait(2.119);
    vi.advanceTimersByTime(1);
    expect(recorder.getState().status).toBe("recording");
    wait(9); // past the loop's end
    await recorder.stop();
    const [note] = take()?.notes ?? [];
    expect(note.start + note.length).toBeLessThanOrEqual(project.length);
    expect(take()?.lengthBeats).toBe(project.length);
  });

  it("keeps a key pressed just before the end inside the loop, though it's shorter than a 16th", async () => {
    const { recorder, project, wait, take } = setUp();
    recorder.setCountInBars(0);
    await recorder.start();
    wait((project.length - 0.06) / 2); // 0.06 of a beat before the end
    recorder.noteOn(71);
    await recorder.stop();
    const [note] = take()?.notes ?? [];
    expect(note.start + note.length).toBeCloseTo(project.length, 5);
    expect(take()?.lengthBeats).toBe(project.length);
  });

  it("ends itself after one pass: the take is launched, play carries on, and the timeline is untouched", async () => {
    const { recorder, project, transport, commands, wait, take } = setUp();
    const trackId = project.selectedId!;
    const placements = project.getTrack(trackId)?.placements;
    recorder.setCountInBars(0);
    await recorder.start();
    wait(1);
    recorder.noteOn(60);
    wait(0.5);
    recorder.noteOff(60);
    wait(project.length / 2); // past the end of the pass
    expect(recorder.getState().status).toBe("idle");
    expect(transport.playing).toBe(true);
    const id = commands.find((command) => command.type === "pasteClip")?.id;
    expect(commands.map((command) => command.type)).toEqual(["pasteClip", "launchClip"]);
    expect(commands[1]).toEqual({ type: "launchClip", trackId, clipId: id });
    expect(take()?.notes.map((note) => note.start)).toEqual([2]);
    expect(take()?.lengthBeats).toBe(project.length);
    expect(project.getTrack(trackId)?.placements).toBe(placements);
  });

  it("lands a take stopped part way as the whole loop, and stops play", async () => {
    const { recorder, project, transport, wait, take } = setUp();
    recorder.setCountInBars(0);
    await recorder.start();
    recorder.noteOn(60);
    wait(1);
    await recorder.stop();
    expect(transport.playing).toBe(false);
    expect(take()?.lengthBeats).toBe(project.length);
  });

  it("ends a key let go after the loop came round at the end, too", async () => {
    const { recorder, project, wait, takeNotes } = setUp();
    recorder.setCountInBars(0);
    await recorder.start();
    wait((project.length - 1) / 2);
    recorder.noteOn(64);
    wait(1);
    recorder.noteOff(64);
    await recorder.stop();
    expect(takeNotes()[0].length).toBeCloseTo(1, 5);
  });
});
