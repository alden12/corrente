import { describe, expect, it, vi } from "vitest";
import { TrackNotes } from "../src/audio/live/trackNotes";
import { playingEdges } from "../src/ui/keys/playingEdges";
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

describe("marking notes no shown key holds", () => {
  const row = (pitches: number[]): KeyCell[] =>
    pitches.map((pitch) => ({ code: `k${pitch}`, pad: { pitches: [pitch], name: "", label: "", tone: "in-scale" } }));
  // C major, two octave rows: C3..E3 and C4..E4.
  const rows = [row([48, 50, 52]), row([60, 62, 64])];

  it("marks nothing for notes on the keys", () => {
    expect(playingEdges(rows, new Set([50, 62])).size).toBe(0);
  });

  it("marks a note above the keys on its column's top edge, and one below on its bottom edge", () => {
    expect(playingEdges(rows, new Set([74]))).toEqual(new Map([["k62", ["top"]]]));
    expect(playingEdges(rows, new Set([38]))).toEqual(new Map([["k50", ["bottom"]]]));
  });

  it("marks a note with no key of its own beside the key under it", () => {
    // E flat 3: no key in C major's rows, so D3's right edge.
    expect(playingEdges(rows, new Set([51]))).toEqual(new Map([["k50", ["right"]]]));
  });

  it("marks every key holding that neighbour, as every key holding a note lights", () => {
    // C4 on two keys, E4 above: C sharp 4 has no key, so both C4s are marked.
    const repeated = [row([60, 64]), row([60]).map((cell) => ({ ...cell, code: "again" }))];
    expect(playingEdges(repeated, new Set([61]))).toEqual(
      new Map([
        ["k60", ["right"]],
        ["again", ["right"]],
      ]),
    );
  });
});
