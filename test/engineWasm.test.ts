import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startEngine, type EngineExports } from "../src/audio/bank/exports";

/**
 * The committed engine.wasm (INST-36) loads, knows the blocks in engine/blocks, and plays a plan
 * through its exports. CI separately rebuilds it and compares the hash (`yarn engine:check`), and the
 * router's behaviour has Rust tests (`yarn engine:test`); this checks the file everyone else runs,
 * from JavaScript, the way the app will call it.
 */
const engineDir = fileURLToPath(new URL("../engine/", import.meta.url));
const bytes = readFileSync(`${engineDir}engine.wasm`);
const instantiate = () => startEngine(bytes);
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
    // A panner: one signal in, left and right out.
    expect(engine.eng_block_inputs(kindOf("pan"))).toBe(1);
    expect(engine.eng_block_outputs(kindOf("pan"))).toBe(2);
    // A meter: its signal passes through, and its level shows on a meter.
    expect(engine.eng_block_meters(kindOf("meter"))).toBe(1);
    expect(engine.eng_block_meters(kindOf("ladder"))).toBe(0);
  });

  it("answers -1 for a kind that does not exist", () => {
    [-1, kinds.length, 1000].forEach((kind) => {
      expect(engine.eng_block_inputs(kind)).toBe(-1);
      expect(engine.eng_block_outputs(kind)).toBe(-1);
      expect(engine.eng_block_controls(kind)).toBe(-1);
      expect(engine.eng_block_meters(kind)).toBe(-1);
    });
  });
});

describe("playing a plan", () => {
  // The plan words the compiler writes (engine/src/plan/mod.rs has the layout): four voices, each
  // multiplying its gate by 1, so a track plays 0 until the note starts and 1 after.
  const GATE = 1;
  const floatBits = (value: number) => new Int32Array(Float32Array.of(value).buffer)[0];
  const mulOfGate = [
    ...[0, 4, 0], // no params, four voices, no latency
    ...[0, 0], // the pre section: no nodes, no steps
    ...[1, 1], // the voice section: one node, one step
    ...[kindOf("mul"), 2, 0], // a multiply with two audio inputs and no controls
    ...[4, GATE, 0], // input a: the voice's gate
    ...[3, 0, floatBits(1)], // input b: the constant 1
    ...[0, 1, 0], // the one step: run node 0 over the block
    ...[0, 0], // the post section: none
    ...[1, 0, 0, 0], // each voice plays node 0's first output, in both channels
    ...[2, 6, 0, 0, 6, 1, 0], // the track plays the voices summed, left and right
  ];

  const load = (exports: EngineExports, track: number, words: number[]) => {
    const pointer = exports.eng_malloc(words.length * 4);
    new Int32Array(exports.memory.buffer, pointer, words.length).set(words);
    const result = exports.eng_load(track, pointer, words.length);
    exports.eng_free(pointer);
    return result;
  };
  const output = (exports: EngineExports, track: number, channel: number) =>
    Array.from(new Float32Array(exports.memory.buffer, exports.eng_output(track, channel), 128));

  it("starts a note on the sample it was asked for, in both channels", () => {
    const exports = instantiate();
    exports.eng_init(48000, 1);
    expect(load(exports, 0, mulOfGate)).toBe(0);
    exports.eng_note_on(0, 0, 37, 440, 1);
    exports.eng_process();
    [0, 1].forEach((channel) => {
      const block = output(exports, 0, channel);
      expect(block.slice(0, 37).every((sample) => sample === 0)).toBe(true);
      expect(block.slice(37).every((sample) => sample === 1)).toBe(true);
    });
    expect(exports.eng_voice_active(0, 0)).toBe(1);
  });

  it("refuses a plan cut short, and keeps the one it had", () => {
    const exports = instantiate();
    exports.eng_init(48000, 1);
    expect(load(exports, 0, mulOfGate)).toBe(0);
    expect(load(exports, 0, mulOfGate.slice(0, -1))).toBe(-2);
    exports.eng_note_on(0, 0, 0, 440, 1);
    exports.eng_process();
    expect(output(exports, 0, 0)[0]).toBe(1);
  });

  it("runs a bank of tracks, each with its own plan and notes", () => {
    const exports = instantiate();
    exports.eng_init(48000, 2);
    expect(load(exports, 0, mulOfGate)).toBe(0);
    expect(load(exports, 1, mulOfGate)).toBe(0);
    expect(load(exports, 2, mulOfGate)).toBe(-1);
    exports.eng_note_on(1, 0, 0, 440, 1);
    exports.eng_process();
    expect(output(exports, 0, 0).every((sample) => sample === 0)).toBe(true);
    expect(output(exports, 1, 0).every((sample) => sample === 1)).toBe(true);
  });

  it("takes audio in for a track with no voices", () => {
    // A return track: its post section doubles the main input's left channel.
    const doubler = [
      ...[0, 0, 0], // no params, no voices, no latency
      ...[0, 0, 0, 0], // no pre or voice section
      ...[1, 1, kindOf("mul"), 2, 0, ...[7, 0, 0], ...[3, 0, floatBits(2)], ...[0, 1, 0]],
      ...[0], // no voice output
      ...[1, 0, 0, 0], // the track plays the multiply
    ];
    const exports = instantiate();
    exports.eng_init(48000, 1);
    expect(load(exports, 0, doubler)).toBe(0);
    new Float32Array(exports.memory.buffer, exports.eng_input(0, 0), 128).fill(0.25);
    exports.eng_process();
    expect(output(exports, 0, 0).every((sample) => sample === 0.5)).toBe(true);
  });

  it("reports a track's peak, silence and latency, and a block's meter", () => {
    // The gate plan with a meter on the voices summed, and 64 samples of latency declared.
    const metered = [
      ...[0, 4, 64],
      ...mulOfGate.slice(3, -13), // the same pre and voice sections
      ...[1, 1, kindOf("meter"), 1, 0, ...[6, 0, 0], ...[0, 1, 0]], // post: a meter on the sum
      ...[1, 0, 0, 0], // each voice plays the multiply
      ...[1, 0, 0, 0], // the track plays the meter's output
    ];
    const exports = instantiate();
    exports.eng_init(48000, 1);
    expect(load(exports, 0, metered)).toBe(0);
    exports.eng_process();
    expect([exports.eng_track_peak(0, 0), exports.eng_track_silent(0)]).toEqual([0, 1]);
    exports.eng_note_on(0, 0, 0, 440, 1);
    exports.eng_process();
    expect([exports.eng_track_peak(0, 1), exports.eng_track_silent(0)]).toEqual([1, 0]);
    expect(exports.eng_meter(0, 2, 0, 0)).toBe(1);
    expect(exports.eng_meter(0, 2, 0, 1)).toBeNaN();
    expect(exports.eng_track_latency(0)).toBe(64);
    expect([exports.eng_track_latency(1), exports.eng_track_silent(1), exports.eng_track_peak(1, 0)]).toEqual([
      -1, -1, -1,
    ]);
  });

  it("grows memory to load a big plan, and its addresses still work after", () => {
    const exports = instantiate();
    const before = exports.memory.buffer.byteLength;
    exports.eng_init(48000, 16);
    // 16 tracks of 64 voices: more than the module starts with.
    const big = [...mulOfGate.slice(0, 1), 64, ...mulOfGate.slice(2)];
    Array.from({ length: 16 }, (_, track) => expect(load(exports, track, big)).toBe(0));
    expect(exports.memory.buffer.byteLength).toBeGreaterThan(before);
    exports.eng_note_on(15, 63, 0, 440, 1);
    exports.eng_process();
    expect(output(exports, 15, 0).every((sample) => sample === 1)).toBe(true);
  });
});
