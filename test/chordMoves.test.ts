import { describe, expect, it } from "vitest";
import { chordRows, type ChordPad } from "../src/audio/theory/chords";
import { DEFAULT_CHORD_PREFS } from "../src/audio/theory/chordPrefs";
import { nextChordHint } from "../src/audio/theory/chordMoves";
import { SCALES, type ScaleName } from "../src/audio/theory/scales";

/** Every chord pad in a key, by name. */
const padsIn = (tonic: number, scale: ScaleName) =>
  new Map(
    chordRows({ tonic, scale, lowOctave: 4, prefs: DEFAULT_CHORD_PREFS })
      .flat()
      .flatMap((pad): [string, ChordPad][] => (pad ? [[pad.name, pad]] : [])),
  );

/** What lights after `from`, by strength: the triads only, so the lists read as a progression. */
const lit = (from: string, tonic = 0, scale: ScaleName = "major") => {
  const pads = padsIn(tonic, scale);
  const after = pads.get(from)!;
  const triads = [...pads.values()].filter((pad) => pad.family === "triad");
  const named = (hint: string) =>
    [
      ...new Set(
        triads.filter((pad) => nextChordHint(after, pad, SCALES[scale].length) === hint).map((pad) => pad.name),
      ),
    ].sort();
  return { strong: named("strong"), good: named("good") };
};

describe("nextChordHint (DAW-12.2)", () => {
  it("from home, lights IV and V brightly, and ii and vi faintly", () => {
    expect(lit("C")).toEqual({ strong: ["F", "G"], good: ["Am", "Dm"] });
  });

  it("from V, lights home, and vi as the deceptive cadence", () => {
    expect(lit("G")).toEqual({ strong: ["C"], good: ["Am"] });
    expect(lit("G7")).toEqual({ strong: ["C"], good: ["Am"] });
  });

  it("from IV, lights V and home", () => {
    expect(lit("F").strong).toEqual(["C", "G"]);
  });

  it("follows the circle of fifths down: vi to ii, ii to V", () => {
    expect(lit("Am").strong).toContain("Dm");
    expect(lit("Dm").strong).toContain("G");
  });

  it("leads a diminished chord up a semitone", () => {
    expect(lit("B°")).toEqual({ strong: ["C"], good: [] });
  });

  it("resolves a secondary dominant to its target, and nothing else", () => {
    // E is V of vi in C major.
    expect(lit("E")).toEqual({ strong: ["Am"], good: [] });
  });

  it("resolves a sus chord to its own triad", () => {
    const pads = padsIn(0, "major");
    expect(nextChordHint(pads.get("Csus4")!, pads.get("C")!, 7)).toBe("strong");
  });

  it("never lights a chord outside the key", () => {
    const pads = padsIn(0, "major");
    expect(nextChordHint(pads.get("C")!, pads.get("D")!, 7)).toBeNull();
  });

  it("holds in another key and mode: A minor's iv and VII lead home and to III", () => {
    expect(lit("Dm", 9, "minor").strong).toContain("G");
    expect(lit("G", 9, "minor").strong).toContain("C");
  });
});
