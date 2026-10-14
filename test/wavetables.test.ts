import { describe, expect, it } from "vitest";
import { CYCLE, LEVELS, MAX_CYCLES, cyclesOf, tableOf } from "../src/audio/samples/tables";

/**
 * Wavetables for the new engine (INST-36.6): cycles cut from audio, and each cycle stored at every
 * level with half the harmonics of the one before, in the layout the engine reads.
 */
const harmonic = (number: number, amplitude = 1) =>
  Float32Array.from({ length: CYCLE }, (_, index) => amplitude * Math.sin((2 * Math.PI * number * index) / CYCLE));
const plus = (a: Float32Array, b: Float32Array) => a.map((value, index) => value + b[index]);
const largestDifference = (a: Float32Array, b: Float32Array) =>
  Math.max(...a.map((value, index) => Math.abs(value - b[index])));

describe("wavetables", () => {
  it("keeps each level's harmonics and drops the rest", () => {
    // The 1st harmonic and the 100th: level 3 (up to 128) keeps both, level 4 (up to 64) only the 1st.
    const cycle = plus(harmonic(1), harmonic(100, 0.5));
    const table = tableOf([cycle]);
    const level = (number: number) => table.subarray(number * CYCLE, (number + 1) * CYCLE);
    expect(largestDifference(level(0), cycle)).toBeLessThan(1e-5);
    expect(largestDifference(level(3), cycle)).toBeLessThan(1e-5);
    expect(largestDifference(level(4), harmonic(1))).toBeLessThan(1e-5);
    expect(largestDifference(level(LEVELS - 1), harmonic(1))).toBeLessThan(1e-5);
  });

  it("lays out every level's cycles in turn, as the engine reads them", () => {
    const table = tableOf([harmonic(1), harmonic(2)]);
    expect(table.length).toBe(LEVELS * 2 * CYCLE);
    // Level 1's second cycle comes after level 1's first, which comes after both of level 0's.
    const at = (level: number, cycle: number) =>
      table.subarray((level * 2 + cycle) * CYCLE, (level * 2 + cycle + 1) * CYCLE);
    expect(largestDifference(at(1, 1), harmonic(2))).toBeLessThan(1e-5);
    expect(largestDifference(at(1, 0), harmonic(1))).toBeLessThan(1e-5);
  });

  it("cuts audio into whole cycles, up to the most a table keeps", () => {
    expect(cyclesOf(new Float32Array(2.5 * CYCLE))).toHaveLength(2);
    expect(cyclesOf(new Float32Array(CYCLE - 1))).toHaveLength(0);
    expect(cyclesOf(new Float32Array((MAX_CYCLES + 3) * CYCLE))).toHaveLength(MAX_CYCLES);
  });
});
