import { describe, expect, it, vi } from "vitest";
import { TrackNotes } from "../src/audio/live/trackNotes";
import { outOfRange } from "../src/ui/keys/outOfRange";
import type { KeyCell } from "../src/ui/keys/keyLayout";

describe("what each track is playing (MOBILE-13)", () => {
  it("holds a track's notes as reported, tells its listeners, and forgets a track that went", () => {
    const notes = new TrackNotes();
    const heard = vi.fn();
    notes.subscribe(heard);
    expect(notes.get("t1").size).toBe(0);
    notes.report("t1", [60, 64]);
    expect([...notes.get("t1")]).toEqual([60, 64]);
    expect(notes.get("t2").size).toBe(0);
    notes.drop("t1");
    expect(notes.get("t1").size).toBe(0);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("applies a report after the output's delay, so the keys light as the note is heard", () => {
    vi.useFakeTimers();
    const notes = new TrackNotes();
    notes.report("t1", [60], 30);
    expect(notes.get("t1").size).toBe(0);
    vi.advanceTimersByTime(30);
    expect([...notes.get("t1")]).toEqual([60]);
    vi.useRealTimers();
  });
});

describe("notes off the shown keys", () => {
  const row = (pitches: number[]): KeyCell[] =>
    pitches.map((pitch) => ({ code: `k${pitch}`, pad: { pitches: [pitch], name: "", label: "", tone: "in-scale" } }));
  const rows = [row([48, 50, 52]), row([60, 62, 64])];

  it("says which way they are, and nothing for notes on the keys", () => {
    expect(outOfRange(new Set([50, 62]), rows)).toEqual({ above: false, below: false });
    expect(outOfRange(new Set([72]), rows)).toEqual({ above: true, below: false });
    expect(outOfRange(new Set([36, 80]), rows)).toEqual({ above: true, below: true });
    expect(outOfRange(new Set(), rows)).toEqual({ above: false, below: false });
  });
});
