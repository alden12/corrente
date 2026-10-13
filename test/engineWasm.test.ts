import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The committed engine.wasm (INST-36.1) loads and knows the blocks in engine/blocks. CI separately
 * rebuilds it and compares the hash (`yarn engine:check`); this checks the file everyone else runs,
 * so a build that compiles but describes the wrong blocks still fails here.
 */
interface EngineExports {
  eng_block_count(): number;
  eng_block_inputs(kind: number): number;
  eng_block_outputs(kind: number): number;
  eng_block_controls(kind: number): number;
}

const engineDir = fileURLToPath(new URL("../engine/", import.meta.url));
const engine = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(`${engineDir}engine.wasm`)), {})
  .exports as unknown as EngineExports;

/** Kinds are numbered by sorted file name, as build.rs registers them. */
const kinds = readdirSync(`${engineDir}blocks`)
  .filter((file) => file.endsWith(".dsp"))
  .map((file) => file.replace(/\.dsp$/, ""))
  .sort();
const kindOf = (name: string) => kinds.indexOf(name);

describe("the engine module", () => {
  it("has one kind per block source", () => {
    expect(engine.eng_block_count()).toBe(kinds.length);
  });

  it("builds every block and reports its ports", () => {
    kinds.forEach((_, kind) => {
      expect(engine.eng_block_inputs(kind)).toBeGreaterThanOrEqual(0);
      expect(engine.eng_block_outputs(kind)).toBeGreaterThanOrEqual(1);
      expect(engine.eng_block_controls(kind)).toBeGreaterThanOrEqual(0);
    });
  });

  it("matches what the block sources declare", () => {
    // A filter: the signal is audio, cutoff and resonance are control inputs (sliders).
    expect(engine.eng_block_inputs(kindOf("ladder"))).toBe(1);
    expect(engine.eng_block_controls(kindOf("ladder"))).toBe(2);
    // An envelope: the gate is audio, the four times and level are controls.
    expect(engine.eng_block_inputs(kindOf("adsr"))).toBe(1);
    expect(engine.eng_block_controls(kindOf("adsr"))).toBe(4);
    // A source: nothing in.
    expect(engine.eng_block_inputs(kindOf("noise"))).toBe(0);
    expect(engine.eng_block_controls(kindOf("noise"))).toBe(0);
  });

  it("answers -1 for a kind that does not exist", () => {
    [-1, kinds.length, 1000].forEach((kind) => {
      expect(engine.eng_block_inputs(kind)).toBe(-1);
      expect(engine.eng_block_outputs(kind)).toBe(-1);
      expect(engine.eng_block_controls(kind)).toBe(-1);
    });
  });
});
