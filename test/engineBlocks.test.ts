import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BlockSpec, Catalogue, Port } from "../engine/catalogue.ts";
import { BLOCK, type EngineExports } from "../src/audio/bank/exports";
import { engineOf, fillInput, loadWords, peakOf, RATE, renderBlocks } from "./support/engine";

/**
 * Every block in the catalogue (INST-36.2), run in the committed engine.wasm: its ports agree with
 * what the engine reports, and driven across the ranges it declares, its outputs stay finite and
 * within the ranges it declares for them. That catches a block whose internals Faust sized for
 * inputs within -1..1 (the prototype's 3-sample delay), and a range declared wrong.
 */
const engineDir = fileURLToPath(new URL("../engine/", import.meta.url));
const catalogue = JSON.parse(readFileSync(`${engineDir}catalogue.json`, "utf8")) as Catalogue;

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
    ...[params, 0], // a param per input and control, no voices
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
  const loaded = loadWords(engine, 0, planFor(block, port));
  if (loaded !== 0) return [`the plan was refused (${loaded})`];
  const settings = settingsFor(block);
  settings[0].forEach((value, index) => engine.eng_init_param(0, index, value));
  // A little slack past the declared range, for filters ringing and band-limited edges overshooting.
  const slack = (output.max - output.min) * 0.05 + 1e-3;
  return settings.flatMap((setting, step) => {
    setting.forEach((value, index) => engine.eng_set_param(0, index, value));
    const samples = renderBlocks(engine, 8);
    const worst = samples.find(
      (sample) => !Number.isFinite(sample) || sample < output.min - slack || sample > output.max + slack,
    );
    return worst === undefined ? [] : [`${output.name} reached ${worst} at setting ${step} [${setting.join(", ")}]`];
  });
};

describe("the block catalogue", () => {
  const engine = engineOf();
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
      const engine = engineOf();
      const problems = block.outputs.flatMap((output, port) => outOfRange(engine, block, port, output));
      expect(problems).toEqual([]);
    },
  );
});

/**
 * Run one block on its own for `blocks` blocks: its audio inputs from the track's input channels,
 * filled by `input(channel, block)`, its controls set to `controls` (by name, the rest at their
 * starting values), and return its output `port`, end to end.
 */
const runBlock = (
  name: string,
  {
    input = () => 0,
    controls = {},
    port = 0,
    blocks = 1,
  }: {
    input?: (channel: number, sample: number) => number;
    controls?: Record<string, number>;
    port?: number;
    blocks?: number;
  },
) => {
  const block = catalogue.blocks.find((candidate) => candidate.name === name)!;
  const engine = engineOf();
  const words = [
    ...[block.controls.length, 0], // a param per control, no voices
    ...[0, 0, 0, 0], // no pre or voice section
    ...[1, 1, block.kind, block.inputs.length, block.controls.length],
    ...block.inputs.flatMap((_, channel) => [7, channel, 0]),
    ...block.controls.flatMap((_, index) => [2, index, 0]),
    ...[0, 1, 0, 0, 1, 0, 0, port],
  ];
  expect(loadWords(engine, 0, words)).toBe(0);
  block.controls.forEach((control, index) => engine.eng_init_param(0, index, controls[control.name] ?? control.init));
  return Array.from({ length: blocks }, (_, at) => {
    block.inputs.forEach((_, channel) => fillInput(engine, 0, channel, (index) => input(channel, at * BLOCK + index)));
    return renderBlocks(engine, 1);
  }).flat();
};

describe("the new blocks do what they say", () => {
  it("lfo: every shape starts its cycle together", () => {
    // 1 Hz: a quarter of the way through, sine, triangle and square are at their top and the saw is
    // halfway up from -1; three quarters through, the opposite.
    const shapes = [0, 1, 2, 3].map((port) => runBlock("lfo", { input: () => 1, port, blocks: 375 }));
    const at = (fraction: number) =>
      shapes.map((shape) => Math.round(shape[Math.round(48000 * fraction)] * 100) / 100 + 0);
    expect(at(0.25)).toEqual([1, 1, -0.5, 1]);
    expect(at(0.75)).toEqual([-1, -1, 0.5, -1]);
  });

  it("hold: keeps its value between triggers", () => {
    // A rising ramp, triggered every 100 samples: steps, flat in between.
    const held = runBlock("hold", {
      input: (channel, sample) => (channel === 0 ? sample / 1000 : sample % 100 < 50 ? 1 : 0),
      blocks: 2,
    });
    expect(held.slice(5, 95).every((value) => value === held[5])).toBe(true);
    expect(held[105]).toBeCloseTo(0.1, 2);
  });

  it("svf: splits the signal into low, band and high", () => {
    // A 100 Hz sine through a 1 kHz cutoff: the low-pass keeps it, the high-pass all but removes it.
    const sine = (_: number, sample: number) => Math.sin((2 * Math.PI * 100 * sample) / 48000);
    const [low, band, high] = [0, 1, 2].map((port) =>
      peakOf(runBlock("svf", { input: sine, port, blocks: 40 }).slice(-2048)),
    );
    expect(low).toBeGreaterThan(0.95);
    expect(high).toBeLessThan(0.02);
    expect(band).toBeLessThan(low);
  });

  it("keyedcompressor: keyed by the signal itself, turns it down by its ratio", () => {
    // Full scale in every input, the key too, threshold -18 dB, ratio 4: 18 dB over becomes 4.5 dB
    // over, -13.5 dB in all.
    const out = runBlock("keyedcompressor", {
      input: () => 1,
      controls: { threshold: -18, ratio: 4, attack: 0.001 },
      blocks: 40,
    });
    expect(20 * Math.log10(out[out.length - 1])).toBeCloseTo(-13.5, 0);
  });

  it("chorus: mixes in a delayed copy", () => {
    // An impulse comes back once, about the delay later.
    const out = runBlock("chorus", {
      input: (_, sample) => (sample === 0 ? 1 : 0),
      controls: { depth: 0, delay: 10, mix: 0.5 },
      blocks: 8,
    });
    expect(out[0]).toBeCloseTo(0.5, 3);
    expect(peakOf(out.slice(470, 490))).toBeGreaterThan(0.2);
    expect(peakOf(out.slice(10, 460))).toBeLessThan(1e-6);
  });

  it("reverb: an impulse grows a tail that dies away", () => {
    const out = runBlock("reverb", {
      input: (_, sample) => (sample === 0 ? 1 : 0),
      controls: { mix: 1, decay: 0.5, predelay: 10 },
      blocks: 1500,
    });
    const second = (index: number) => peakOf(out.slice(index * 12000, (index + 1) * 12000));
    // Silent through the pre-delay, then a tail that keeps falling.
    expect(peakOf(out.slice(0, 400))).toBeLessThan(1e-6);
    expect(second(0)).toBeGreaterThan(0.001);
    expect(second(4)).toBeLessThan(second(0) / 100);
  });

  it("biquad: has Web Audio's response for every type", () => {
    // The magnitude Web Audio's spec gives (its Audio EQ Cookbook coefficients), against a sine's level
    // through the block once it settles.
    const TYPES = ["lowpass", "highpass", "bandpass", "lowshelf", "highshelf", "peaking", "notch", "allpass"];
    const specResponse = (type: number, cutoff: number, q: number, gain: number, at: number) => {
      const w0 = (2 * Math.PI * cutoff) / RATE;
      const [cos, sin] = [Math.cos(w0), Math.sin(w0)];
      const A = 10 ** (gain / 40);
      const alphaQ = sin / (2 * q);
      const alphaQdB = sin / (2 * 10 ** (q / 20));
      const root = 2 * (sin / Math.SQRT2) * Math.sqrt(A);
      const coefficients: [number, number, number, number, number, number][] = [
        [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alphaQdB, -2 * cos, 1 - alphaQdB],
        [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alphaQdB, -2 * cos, 1 - alphaQdB],
        [alphaQ, 0, -alphaQ, 1 + alphaQ, -2 * cos, 1 - alphaQ],
        [
          A * (A + 1 - (A - 1) * cos + root),
          2 * A * (A - 1 - (A + 1) * cos),
          A * (A + 1 - (A - 1) * cos - root),
          A + 1 + (A - 1) * cos + root,
          -2 * (A - 1 + (A + 1) * cos),
          A + 1 + (A - 1) * cos - root,
        ],
        [
          A * (A + 1 + (A - 1) * cos + root),
          -2 * A * (A - 1 + (A + 1) * cos),
          A * (A + 1 + (A - 1) * cos - root),
          A + 1 - (A - 1) * cos + root,
          2 * (A - 1 - (A + 1) * cos),
          A + 1 - (A - 1) * cos - root,
        ],
        [1 + alphaQ * A, -2 * cos, 1 - alphaQ * A, 1 + alphaQ / A, -2 * cos, 1 - alphaQ / A],
        [1, -2 * cos, 1, 1 + alphaQ, -2 * cos, 1 - alphaQ],
        [1 - alphaQ, -2 * cos, 1 + alphaQ, 1 + alphaQ, -2 * cos, 1 - alphaQ],
      ];
      const [b0, b1, b2, a0, a1, a2] = coefficients[type];
      const w = (2 * Math.PI * at) / RATE;
      // |b0 + b1 z^-1 + b2 z^-2| / |a0 + a1 z^-1 + a2 z^-2| on the unit circle.
      const magnitude = (c0: number, c1: number, c2: number) =>
        Math.hypot(c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w), c1 * Math.sin(w) + c2 * Math.sin(2 * w));
      return magnitude(b0, b1, b2) / magnitude(a0, a1, a2);
    };
    const problems = TYPES.flatMap((name, type) =>
      [200, 1000, 2500, 8000].flatMap((at) => {
        const [cutoff, q, gain] = [1000, type < 2 ? 6 : 2, 9];
        const out = runBlock("biquad", {
          input: (_, sample) => 0.25 * Math.sin((2 * Math.PI * at * sample) / RATE),
          controls: { type, frequency: cutoff, q, gain },
          blocks: 60,
        });
        // The level as RMS: a sampled peak misses the true one at a few samples a cycle.
        const settled = out.slice(-2400);
        const rms = Math.sqrt(settled.reduce((total, value) => total + value * value, 0) / settled.length);
        const [measured, expected] = [(rms * Math.SQRT2) / 0.25, specResponse(type, cutoff, q, gain, at)];
        const apart = Math.abs(20 * Math.log10(measured / expected));
        // Within 0.2 dB, or both far below (a notch's floor).
        return apart < 0.2 || Math.max(measured, expected) < 0.01
          ? []
          : [`${name} at ${at} Hz: ${measured} vs ${expected}`];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("triangle: rises from 0, at full scale", () => {
    const out = runBlock("triangle", { input: () => 100, blocks: 4 });
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeGreaterThan(0);
    // A quarter of a 100 Hz cycle in, at its top.
    expect(out[120]).toBeCloseTo(1, 2);
    expect(Math.min(...out)).toBeCloseTo(-1, 2);
  });

  it("bitcrush: holds each sample, then snaps it to its levels", () => {
    const ramp = (sample: number) => sample / 64 - 1;
    // At 16 bits, the hold alone: taken every 4 samples.
    const held = runBlock("bitcrush", { input: (_, sample) => ramp(sample), controls: { bits: 16, downsample: 4 } });
    expect(held.slice(0, 4).every((value) => value === held[0])).toBe(true);
    expect(held[4]).toBeCloseTo(ramp(4), 3);
    // Two bits, no hold: four levels across -1..1.
    const snapped = runBlock("bitcrush", { input: (_, sample) => ramp(sample), controls: { bits: 2, downsample: 1 } });
    expect(new Set(snapped.map((value) => Math.round(value * 1000) / 1000))).toEqual(new Set([-1, -0.333, 0.333, 1]));
  });

  it("waveshaper: plays each of its curves", () => {
    // The Distortion's four curves, by `shape`'s index, as functions of x in -1..1 and `amount`.
    const drive = (amount: number, per: number) => 1 + amount * per;
    const curves = [
      (x: number, amount: number) => ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x)),
      (x: number, amount: number) => Math.tanh(drive(amount, 0.2) * x) / Math.tanh(drive(amount, 0.2)),
      (x: number, amount: number) => Math.max(-1, Math.min(1, drive(amount, 0.2) * x)),
      (x: number, amount: number) => Math.sin((Math.PI / 2) * drive(amount, 0.1) * x),
    ];
    const amount = 30;
    const problems = curves.flatMap((curve, shape) => {
      const out = runBlock("waveshaper", { input: (_, sample) => sample / 64 - 1, controls: { shape, amount } });
      return out.flatMap((value, sample) => {
        const x = Math.min(1, sample / 64 - 1);
        const expected = curve(x, amount);
        return Math.abs(value - expected) < 0.02 ? [] : [`shape ${shape} at ${x}: ${value} vs ${expected}`];
      });
    });
    expect(problems).toEqual([]);
  });
});
