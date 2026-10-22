/**
 * PLUGIN-2.1's reference: render every built-in instrument and effect with `renderDevice` on
 * engine.wasm, recording each `eng_*` call it makes (with the plans, samples and input audio it hands
 * over) and the output after every block. The Rust replay (src/main.rs) makes the same calls on the
 * engine built natively and compares its output with this one.
 *
 *   npx tsx engine/replay/record.ts <out dir>
 *
 * Writes `<device>.log` (one call a line, ending `= <result>` where it answered) and `<device>.f32` (each block's output, per track, left
 * then right) for each device.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDevice, type DeviceChain, type Stimulus } from "../../src/audio/render/renderDevice";
import { nodeRenderSetup } from "../../server/render/nodeRender";
import { ENGINE_INSTRUMENTS } from "../../src/audio/instruments/engine";
import { ENGINE_EFFECTS } from "../../src/audio/effects/engine";
import { BLOCK, INPUT_CHANNELS, OUTPUT_CHANNELS, type EngineExports } from "../../src/audio/bank/exports";

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: record.ts <out dir>");
mkdirSync(outDir, { recursive: true });

/** What the current render has recorded. */
let lines: string[] = [];
let blocks: Float32Array[] = [];

const floats = (memory: WebAssembly.Memory, pointer: number, count: number) =>
  Array.from(new Float32Array(memory.buffer, pointer, count));

/** Wrap an engine's exports so every call is logged, and the output kept after every block. */
const recording = (engine: EngineExports): EngineExports => {
  let tracks = 0;
  /** Input channels whose last block sounded, by `track:channel`. */
  const soundingInputs = new Set<string>();
  /** A sample slot reserved but not yet filled: its data is written after eng_sample_reserve returns. */
  let pendingSample: { pointer: number; count: number } | null = null;
  const flushSample = () => {
    if (!pendingSample) return;
    lines.push(`sample_data ${floats(engine.memory, pendingSample.pointer, pendingSample.count).join(" ")}`);
    pendingSample = null;
  };
  const words = (pointer: number, length: number) =>
    Array.from(new Int32Array(engine.memory.buffer, pointer, length)).join(" ");

  const special: Partial<Record<keyof EngineExports, (...args: number[]) => number | void>> = {
    // The replay allocates and frees its own memory: only what's in it matters.
    eng_malloc: (bytes) => engine.eng_malloc(bytes),
    eng_free: (pointer) => engine.eng_free(pointer),
    eng_init: (rate, count) => {
      tracks = count;
      lines.push(`eng_init ${rate} ${count}`);
      return engine.eng_init(rate, count);
    },
    eng_load: (track, pointer, length) => {
      lines.push(`eng_load ${track} ${length} ${words(pointer, length)}`);
      return engine.eng_load(track, pointer, length);
    },
    eng_carry: (track, pointer, length) => {
      lines.push(`eng_carry ${track} ${length} ${words(pointer, length)}`);
      return engine.eng_carry(track, pointer, length);
    },
    eng_bind: (track, pointer, length) => {
      lines.push(`eng_bind ${track} ${length} ${words(pointer, length)}`);
      return engine.eng_bind(track, pointer, length);
    },
    eng_sample_reserve: (slot, frames, channels, rate) => {
      lines.push(`eng_sample_reserve ${slot} ${frames} ${channels} ${rate}`);
      const pointer = engine.eng_sample_reserve(slot, frames, channels, rate);
      if (pointer) pendingSample = { pointer, count: frames * channels };
      return pointer;
    },
    eng_process: () => {
      for (let track = 0; track < tracks; track++)
        for (let channel = 0; channel < INPUT_CHANNELS; channel++) {
          const input = floats(engine.memory, engine.eng_input(track, channel), BLOCK);
          // Silent inputs are left out, but not the first silent block after a sounding one, or the
          // replay would keep playing the last block that sounded.
          const key = `${track}:${channel}`;
          const sounding = input.some((sample) => sample !== 0);
          if (sounding || soundingInputs.has(key)) lines.push(`input ${track} ${channel} ${input.join(" ")}`);
          if (sounding) soundingInputs.add(key);
          else soundingInputs.delete(key);
        }
      lines.push("eng_process");
      engine.eng_process();
      for (let track = 0; track < tracks; track++)
        for (let channel = 0; channel < OUTPUT_CHANNELS; channel++)
          blocks.push(new Float32Array(floats(engine.memory, engine.eng_output(track, channel), BLOCK)));
    },
    // Where input and output live differs natively: the replay asks for its own.
    eng_input: (track, channel) => engine.eng_input(track, channel),
    eng_output: (track, channel) => engine.eng_output(track, channel),
  };

  // A copy rather than a Proxy: an instance's exports are frozen, which a Proxy has to honour.
  return Object.fromEntries(
    Object.entries(engine).map(([name, value]) => {
      if (typeof value !== "function") return [name, value];
      const handle = special[name as keyof EngineExports];
      return [
        name,
        (...args: number[]) => {
          flushSample();
          const logged = lines.length;
          if (!handle) lines.push(`${name} ${args.join(" ")}`.trim());
          const result = (handle ?? (value as (...args: number[]) => number))(...args);
          // What it answered, for the replay to check, except an address (which differs natively).
          if (typeof result === "number" && lines.length === logged + 1 && name !== "eng_sample_reserve")
            lines[logged] += ` = ${result}`;
          return result;
        },
      ];
    }),
  ) as unknown as EngineExports;
};

// renderDevice starts its engine through `new WebAssembly.Instance`: hand it a recording one.
const Instance = WebAssembly.Instance;
WebAssembly.Instance = function (module: WebAssembly.Module, imports?: WebAssembly.Imports) {
  const instance = new Instance(module, imports);
  return { exports: recording(instance.exports as unknown as EngineExports) };
} as unknown as typeof WebAssembly.Instance;

const NOTES: Stimulus = {
  kind: "notes",
  // A low note and a chord over it, overlapping, at different velocities, one let go early.
  notes: [
    { pitch: 36, start: 0, length: 0.5, velocity: 1 },
    { pitch: 60, start: 0.25, length: 1, velocity: 0.8 },
    { pitch: 64, start: 0.5, length: 0.75, velocity: 0.6 },
    { pitch: 67, start: 0.5, length: 0.3, velocity: 0.9 },
  ],
};
const BURST: Stimulus = { kind: "burst", frequency: 440, seconds: 0.2 };

const renders: { name: string; chain: DeviceChain; stimulus: Stimulus; seconds: number }[] = [
  ...ENGINE_INSTRUMENTS.map(({ type }) => ({
    name: type,
    chain: { instrument: { type } },
    stimulus: NOTES,
    seconds: 2,
  })),
  ...ENGINE_EFFECTS.map(({ type }) => ({ name: type, chain: { effects: [{ type }] }, stimulus: BURST, seconds: 1 })),
];

for (const { name, chain, stimulus, seconds } of renders) {
  lines = [];
  blocks = [];
  try {
    await renderDevice(chain, stimulus, seconds, nodeRenderSetup());
  } catch (error) {
    console.log(`${name}: skipped (${(error as Error).message})`);
    continue;
  }
  writeFileSync(join(outDir, `${name}.log`), `${lines.join("\n")}\n`);
  const output = new Float32Array(blocks.reduce((total, block) => total + block.length, 0));
  blocks.reduce((offset, block) => (output.set(block, offset), offset + block.length), 0);
  writeFileSync(join(outDir, `${name}.f32`), Buffer.from(output.buffer));
  console.log(`${name}: ${lines.length} calls, ${blocks.length / 2} blocks`);
}
