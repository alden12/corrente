import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The committed engine.wasm (INST-36) loads, knows the blocks in engine/blocks, and plays a plan
 * through its exports. CI separately rebuilds it and compares the hash (`yarn engine:check`), and the
 * router's behaviour has Rust tests (`yarn engine:test`); this checks the file everyone else runs,
 * from JavaScript, the way the app will call it.
 */
interface EngineExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  eng_malloc(bytes: number): number;
  eng_free(pointer: number): void;
  eng_init(sampleRate: number, maxVoices: number): number;
  eng_load(plan: number, length: number): number;
  eng_note_on(slot: number, offset: number, frequency: number, velocity: number): void;
  eng_note_off(slot: number, offset: number): void;
  eng_voice_active(slot: number): number;
  eng_process(): number;
  eng_block_count(): number;
  eng_block_inputs(kind: number): number;
  eng_block_outputs(kind: number): number;
  eng_block_controls(kind: number): number;
}

const engineDir = fileURLToPath(new URL("../engine/", import.meta.url));
const bytes = readFileSync(`${engineDir}engine.wasm`);
const instantiate = () => {
  const exports = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports as unknown as EngineExports;
  exports._initialize();
  return exports;
};
const engine = instantiate();

/** Kinds are numbered by sorted file name, as compile.ts registers them. */
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

describe("playing a plan", () => {
  // The plan words the compiler writes (engine/src/plan.rs has the layout): one node multiplying the
  // voice's gate by 1, so the output is 0 until the note starts and 1 after.
  const GATE = 1;
  const mulOfGate = [
    ...[1, 0, 1, 0], // one node, no params, one step, output from node 0
    ...[kindOf("mul"), 2, 0], // a multiply with two audio inputs and no controls
    ...[4, GATE, 0], // input a: the voice's gate
    ...[3, 0, new Int32Array(Float32Array.of(1).buffer)[0]], // input b: the constant 1
    ...[0, 1, 0], // the one step: run node 0 over the block
  ];

  const load = (exports: EngineExports, words: number[]) => {
    const pointer = exports.eng_malloc(words.length * 4);
    new Int32Array(exports.memory.buffer, pointer, words.length).set(words);
    const result = exports.eng_load(pointer, words.length);
    exports.eng_free(pointer);
    return result;
  };

  it("starts a note on the sample it was asked for", () => {
    const exports = instantiate();
    exports.eng_init(48000, 4);
    expect(load(exports, mulOfGate)).toBe(0);
    exports.eng_note_on(0, 37, 440, 1);
    const block = Array.from(new Float32Array(exports.memory.buffer, exports.eng_process(), 128));
    expect(block.slice(0, 37).every((sample) => sample === 0)).toBe(true);
    expect(block.slice(37).every((sample) => sample === 1)).toBe(true);
    expect(exports.eng_voice_active(0)).toBe(1);
  });

  it("refuses a plan cut short, and keeps the one it had", () => {
    const exports = instantiate();
    exports.eng_init(48000, 4);
    expect(load(exports, mulOfGate)).toBe(0);
    expect(load(exports, mulOfGate.slice(0, -1))).toBe(-2);
    exports.eng_note_on(0, 0, 440, 1);
    expect(new Float32Array(exports.memory.buffer, exports.eng_process(), 128)[0]).toBe(1);
  });
});
