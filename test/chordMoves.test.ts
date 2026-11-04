import { describe, expect, it } from "vitest";
import { chordRows, type ChordPad } from "../src/audio/theory/chords";
import { DEFAULT_CHORD_PREFS } from "../src/audio/theory/chordPrefs";
import { chordHint, keyChangeTo, nextChordHint } from "../src/audio/theory/chordMoves";
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
    // And its own column: G7 can fall back to G.
    expect(lit("G7")).toEqual({ strong: ["C"], good: ["Am", "G"] });
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

  it("resolves a secondary dominant to its target, and only its own column besides", () => {
    // E is V of vi in C major; its column's triad is Em.
    expect(lit("E")).toEqual({ strong: ["Am"], good: ["Em"] });
  });

  it("resolves a sus chord to its own triad", () => {
    const pads = padsIn(0, "major");
    expect(nextChordHint(pads.get("Csus4")!, pads.get("C")!, 7)).toBe("strong");
  });

  it("lights the rest of a chord's column faintly, a new colour on the same root, but not itself", () => {
    const pads = padsIn(0, "major");
    expect(nextChordHint(pads.get("C")!, pads.get("Cmaj7")!, 7)).toBe("good");
    expect(nextChordHint(pads.get("G")!, pads.get("G7")!, 7)).toBe("good");
    expect(nextChordHint(pads.get("C")!, pads.get("C")!, 7)).toBeNull();
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

describe("key changes (DAW-12.3)", () => {
  const C_MAJOR = { tonic: 0, scale: "major" } as const;
  const pads = padsIn(0, "major");

  it("leads each secondary dominant to its target's key, major or minor as the key's chord there is", () => {
    expect(keyChangeTo(pads.get("D")!, C_MAJOR)).toEqual({ tonic: 7, scale: "major" });
    expect(keyChangeTo(pads.get("E")!, C_MAJOR)).toEqual({ tonic: 9, scale: "minor" });
    expect(keyChangeTo(pads.get("A")!, C_MAJOR)).toEqual({ tonic: 2, scale: "minor" });
    expect(keyChangeTo(pads.get("C7")!, C_MAJOR)).toEqual({ tonic: 5, scale: "major" });
  });

  it("leads nowhere from a chord in the key, or a borrowed minor one", () => {
    expect(keyChangeTo(pads.get("G")!, C_MAJOR)).toBeNull();
    expect(keyChangeTo(pads.get("Fm")!, C_MAJOR)).toBeNull();
  });

  it("isn't a key change for harmonic minor's own V, which leads home", () => {
    const harmonic = padsIn(9, "harmonic minor");
    expect(keyChangeTo(harmonic.get("E")!, { tonic: 9, scale: "harmonic minor" })).toBeNull();
  });

  it("lights a doorway as a key change where it would be a good move: D after C, but not E", () => {
    expect(chordHint(pads.get("C")!, pads.get("D")!, C_MAJOR)).toBe("keyChange");
    // A major third up isn't one of the moves.
    expect(chordHint(pads.get("C")!, pads.get("E")!, C_MAJOR)).toBeNull();
    expect(chordHint(pads.get("C")!, pads.get("G")!, C_MAJOR)).toBe("strong");
  });
});
