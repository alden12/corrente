import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { CATALOGUE } from "../src/audio/definitions/catalogue";
import { compileDefinition, type CompiledPlan } from "../src/audio/definitions/compile";
import type { DeviceDefinition } from "../src/audio/definitions/format";

/**
 * What each block costs to run (INST-36.4's cost cap), in engine/costs.json. Timings depend on the
 * machine, so the build can't make them: `yarn engine:costs` measures them here, in the committed
 * engine.wasm, and the file is committed. Otherwise this only checks every block has a cost, so a
 * new block can't be added without measuring it.
 */
const costsFile = fileURLToPath(new URL("../engine/costs.json", import.meta.url));
const wasm = readFileSync(fileURLToPath(new URL("../engine/engine.wasm", import.meta.url)));
const RATE = 48000;

describe("engine/costs.json", () => {
  it("has a cost for every block (run `yarn engine:costs` after adding one)", () => {
    const costs = JSON.parse(readFileSync(costsFile, "utf8")) as { blocks: Record<string, number> };
    const missing = CATALOGUE.blocks.map((block) => block.name).filter((name) => !(name in costs.blocks));
    expect(missing).toEqual([]);
  });
});

/** Nanoseconds a block of `plan` takes, the best of several runs. */
const timeOf = (plan: CompiledPlan, start: (bank: EngineBank) => void = () => {}) => {
  const bank = new EngineBank(wasm, RATE, 1);
  bank.load(0, plan);
  start(bank);
  let block = 0;
  const run = (blocks: number) => {
    const began = performance.now();
    for (let end = block + blocks; block < end; block++) bank.process((block * BLOCK) / RATE);
    return ((performance.now() - began) * 1e6) / blocks;
  };
  run(500);
  return Math.min(...Array.from({ length: 9 }, () => run(1000)));
};

/** A track running one block once a block, every input at the middle of its range. */
const alone = (name: string): DeviceDefinition => {
  const block = CATALOGUE.blocks.find((candidate) => candidate.name === name)!;
  const inputs = Object.fromEntries(block.inputs.map((port) => [port.name, (port.min + port.max) / 2]));
  return { format: 1, nodes: { only: { block: name, inputs } }, output: "only" };
};

describe.runIf(process.env.MEASURE_COSTS)("measuring", () => {
  it("writes engine/costs.json", () => {
    const empty = timeOf(compileDefinition({ format: 1, nodes: {}, output: "host.tempo" }));
    const blocks = Object.fromEntries(
      CATALOGUE.blocks.map((block) => [
        block.name,
        Math.max(0, Math.round(timeOf(compileDefinition(alone(block.name))) - empty)),
      ]),
    );
    // A voice's own cost beyond its blocks: 64 voices of one `mul`, all held.
    const voices = 64;
    const held = compileDefinition({
      format: 1,
      voices,
      nodes: { vca: { block: "mul", voice: true, inputs: { a: "voice.gate", b: 1 } } },
      voice: "vca",
    });
    const all = timeOf(held, (bank) => Array.from({ length: voices }, (_, note) => bank.noteOn(0, 30 + note, 1, 0)));
    const voice = Math.max(0, Math.round((all - empty) / voices - blocks.mul));
    // How much dearer a block is run a sample at a time: two `mul`s feeding each other.
    const loop = compileDefinition({
      format: 1,
      nodes: {
        x: { block: "mul", inputs: { a: "y", b: 0.5 } },
        y: { block: "mul", inputs: { a: "x", b: 0.5 } },
      },
      output: "x",
    });
    const sampleLoop = Number(((timeOf(loop) - empty) / (2 * blocks.mul)).toFixed(1));
    const costs = {
      about:
        "Nanoseconds per 128-sample block on the machine that measured them (`yarn engine:costs`): each block run once a block, a voice's own cost beyond its blocks, and how many times dearer a block is in a loop run a sample at a time. src/audio/definitions/cost.ts scales them to a phone.",
      blocks,
      voice,
      sampleLoop,
    };
    writeFileSync(costsFile, `${JSON.stringify(costs, null, 2)}\n`);
    expect(Object.keys(blocks)).toHaveLength(CATALOGUE.blocks.length);
  }, 300_000);
});
