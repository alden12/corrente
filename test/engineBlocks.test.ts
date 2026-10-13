import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BlockSpec, Catalogue, Port } from "../engine/catalogue.ts";

/**
 * Every block in the catalogue (INST-36.2), run in the committed engine.wasm: its ports agree with
 * what the engine reports, and driven across the ranges it declares, its outputs stay finite and
 * within the ranges it declares for them. That catches a block whose internals Faust sized for
 * inputs within -1..1 (the prototype's 3-sample delay), and a range declared wrong.
 */
interface EngineExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  eng_malloc(bytes: number): number;
  eng_free(pointer: number): void;
  eng_init(sampleRate: number, tracks: number): number;
  eng_load(track: number, plan: number, length: number): number;
  eng_init_param(track: number, source: number, value: number): void;
  eng_set_param(track: number, source: number, value: number): void;
  eng_output(track: number, channel: number): number;
  eng_process(): void;
  eng_block_count(): number;
  eng_block_inputs(kind: number): number;
  eng_block_outputs(kind: number): number;
  eng_block_controls(kind: number): number;
  eng_block_meters(kind: number): number;
}

const engineDir = fileURLToPath(new URL("../engine/", import.meta.url));
const catalogue = JSON.parse(readFileSync(`${engineDir}catalogue.json`, "utf8")) as Catalogue;
const instantiate = () => {
  const module = new WebAssembly.Module(readFileSync(`${engineDir}engine.wasm`));
  const exports = new WebAssembly.Instance(module, {}).exports as unknown as EngineExports;
  exports._initialize();
  return exports;
};

/** One value per input then per control: what the block is driven with at one moment. */
type Setting = number[];

/**
 * The settings a block is driven through: everything at its middle (inputs) or starting value
 * (controls); then each one alone at its lowest and its highest; then all at their lowest, all at
 * their highest. Params ramp between settings over a block, so the sweeps in between are covered too.
 */
const settingsFor = (block: BlockSpec): Setting[] => {
  const ranges = [...block.inputs, ...block.controls];
  const base = [
    ...block.inputs.map((port) => (port.min + port.max) / 2),
    ...block.controls.map((control) => control.init),
  ];
  const at = (index: number, value: number) => base.map((current, other) => (other === index ? value : current));
  return [
    base,
    ...ranges.flatMap((port, index) => [at(index, port.min), at(index, port.max)]),
    ranges.map((port) => port.min),
    ranges.map((port) => port.max),
    base,
  ];
};

/**
 * A plan of one track with no voices whose post section runs the block, each input and control
 * read from a param, and plays its output `port` (engine/src/plan/mod.rs has the layout).
 */
const planFor = (block: BlockSpec, port: number) => {
  const params = block.inputs.length + block.controls.length;
  const param = (index: number) => [2, index, 0];
  return [
    ...[params, 0, 0], // a param per input and control, no voices, no latency
    ...[0, 0, 0, 0], // no pre or voice section
    ...[1, 1, block.kind, block.inputs.length, block.controls.length],
    ...Array.from({ length: params }, (_, index) => param(index)).flat(),
    ...[0, 1, 0], // run the block over the block
    ...[0], // no voice output
    ...[1, 0, 0, port], // the track plays the block's output `port`
  ];
};

/** Run the block through every setting, and say where an output left its range. */
const outOfRange = (engine: EngineExports, block: BlockSpec, port: number, output: Port) => {
  const words = planFor(block, port);
  const pointer = engine.eng_malloc(words.length * 4);
  new Int32Array(engine.memory.buffer, pointer, words.length).set(words);
  const loaded = engine.eng_load(0, pointer, words.length);
  engine.eng_free(pointer);
  if (loaded !== 0) return [`the plan was refused (${loaded})`];
  const settings = settingsFor(block);
  settings[0].forEach((value, index) => engine.eng_init_param(0, index, value));
  // A little slack past the declared range, for filters ringing and band-limited edges overshooting.
  const slack = (output.max - output.min) * 0.05 + 1e-3;
  return settings.flatMap((setting, step) => {
    setting.forEach((value, index) => engine.eng_set_param(0, index, value));
    const samples = Array.from({ length: 8 }, () => {
      engine.eng_process();
      return Array.from(new Float32Array(engine.memory.buffer, engine.eng_output(0, 0), 128));
    }).flat();
    const worst = samples.find(
      (sample) => !Number.isFinite(sample) || sample < output.min - slack || sample > output.max + slack,
    );
    return worst === undefined ? [] : [`${output.name} reached ${worst} at setting ${step} [${setting.join(", ")}]`];
  });
};

describe("the block catalogue", () => {
  const engine = instantiate();
  const faustBlocks = catalogue.blocks.filter((block) => block.kind < 1000);

  it("has a block for every kind the engine has, numbered in order", () => {
    expect(faustBlocks.map((block) => block.kind)).toEqual(
      Array.from({ length: engine.eng_block_count() }, (_, kind) => kind),
    );
  });

  it.each(faustBlocks.map((block) => [block.name, block] as const))(
    "%s has the ports the engine reports",
    (_, block) => {
      expect([
        engine.eng_block_inputs(block.kind),
        engine.eng_block_outputs(block.kind),
        engine.eng_block_controls(block.kind),
        engine.eng_block_meters(block.kind),
      ]).toEqual([block.inputs.length, block.outputs.length, block.controls.length, block.meters.length]);
    },
  );

  it("names every block once", () => {
    const names = catalogue.blocks.map((block) => block.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("every block, driven across its ranges", () => {
  it.each(catalogue.blocks.map((block) => [block.name, block] as const))(
    "%s stays within its declared output ranges",
    (_, block) => {
      const engine = instantiate();
      engine.eng_init(48000, 1);
      const problems = block.outputs.flatMap((output, port) => outOfRange(engine, block, port, output));
      expect(problems).toEqual([]);
    },
  );
});
