/**
 * What the tests that drive the committed engine.wasm directly share: its bytes, a started engine,
 * loading plan words, and reading and writing a track's audio.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BLOCK, startEngine, withWords, type EngineExports } from "../../src/audio/bank/exports";

export const RATE = 48000;
export const wasm = readFileSync(fileURLToPath(new URL("../../engine/engine.wasm", import.meta.url)));

/** A new engine of `tracks` tracks at RATE. */
export const engineOf = (tracks = 1): EngineExports => {
  const engine = startEngine(wasm);
  engine.eng_init(RATE, tracks);
  return engine;
};

/** Load plan words into a track: eng_load's code, 0 if the engine took them. */
export const loadWords = (engine: EngineExports, track: number, words: ArrayLike<number>) =>
  withWords(engine, words, (pointer) => engine.eng_load(track, pointer, words.length));

/** A track's output channel for the block just rendered, copied out. */
export const outputOf = (engine: EngineExports, track = 0, channel = 0) =>
  Array.from(new Float32Array(engine.memory.buffer, engine.eng_output(track, channel), BLOCK));

/** Fill a track's input channel for the coming block, sample by sample. */
export const fillInput = (
  engine: EngineExports,
  track: number,
  channel: number,
  sampleAt: (index: number) => number,
) => {
  const samples = new Float32Array(engine.memory.buffer, engine.eng_input(track, channel), BLOCK);
  samples.forEach((_, index) => (samples[index] = sampleAt(index)));
};

/** Render `blocks` blocks and return a track's output channel, end to end. */
export const renderBlocks = (engine: EngineExports, blocks: number, track = 0, channel = 0) =>
  Array.from({ length: blocks }, () => {
    engine.eng_process();
    return outputOf(engine, track, channel);
  }).flat();

export const peakOf = (samples: number[]) => Math.max(...samples.map(Math.abs));

/** A float's bit pattern as an int32, the way plan words carry a constant. */
export const floatBits = (value: number) => new Int32Array(Float32Array.of(value).buffer)[0];
