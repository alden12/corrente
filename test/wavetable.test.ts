import { describe, it, expect } from "vitest";
import { buildTables, builtinWavetable, builtinWavetableIds, TABLE_SIZE } from "../src/audio/dsp/wavetable";
import { BUILTIN_WAVETABLES } from "../src/audio/samples/catalog";

const WAVETABLE_BANKS = BUILTIN_WAVETABLES.map((bank) => bank.id);

describe("buildTables", () => {
  it("builds a bank of normalized single-cycle tables", () => {
    const tables = buildTables();
    expect(tables.length).toBe(4);
    for (const table of tables) {
      expect(table.length).toBe(TABLE_SIZE);
      const peak = Math.max(...Array.from(table, Math.abs));
      expect(peak).toBeCloseTo(1, 5); // normalized to full scale
    }
  });

  it("the first table is a sine (zero at phase 0, peak near phase 0.25)", () => {
    const [sine] = buildTables();
    expect(sine[0]).toBeCloseTo(0, 6);
    expect(sine[TABLE_SIZE / 4]).toBeCloseTo(1, 3);
    expect(sine[TABLE_SIZE / 2]).toBeCloseTo(0, 3);
  });
});

describe("builtinWavetable (the built-in wavetables)", () => {
  const bank = (id: string) => builtinWavetable(id)!;
  /** One table's strength at harmonic k (a single DFT bin over its one cycle). */
  const harmonic = (table: Float32Array, k: number) =>
    Math.abs(table.reduce((sum, value, index) => sum + value * Math.sin((2 * Math.PI * k * index) / table.length), 0)) /
    (table.length / 2);

  it("has a bank per name, each table normalised to a peak of 1", () => {
    // The picker's names and the cycles are two lists; they must name the same wavetables.
    expect(builtinWavetableIds().sort()).toEqual([...WAVETABLE_BANKS].sort());
    expect(builtinWavetable("nope")).toBeUndefined();
    for (const table of WAVETABLE_BANKS.flatMap(bank)) {
      expect(table).toHaveLength(TABLE_SIZE);
      expect(Math.max(...table.map(Math.abs))).toBeCloseTo(1, 5);
    }
  });

  it("classic is the Wavetable instrument's bank", () => {
    expect(bank("classic")).toEqual(buildTables());
  });

  it("harmonics pulls in more equal harmonics as it goes", () => {
    const [first, , , , last] = bank("harmonics");
    expect(harmonic(first, 2)).toBeLessThan(0.001);
    expect(harmonic(last, 16) / harmonic(last, 1)).toBeCloseTo(1, 2);
  });

  it("pulse narrows from a square (no even harmonics) to a thin pulse (strong ones)", () => {
    const tables = bank("pulse");
    const [square, thin] = [tables[0], tables[tables.length - 1]];
    expect(harmonic(square, 2)).toBeLessThan(0.001);
    expect(harmonic(thin, 2) / harmonic(thin, 1)).toBeGreaterThan(0.9);
  });
});
