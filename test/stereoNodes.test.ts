import { describe, expect, it } from "vitest";
import { compileDefinition, DefinitionError } from "../src/audio/definitions/compile";
import { engineDevice, registerEngineDevice, unregisterEngineDevice } from "../src/audio/definitions/engineDevices";
import type { DeviceDefinition } from "../src/audio/definitions/format";
import type { ParamSchema } from "../src/audio/params/types";

/**
 * Stereo nodes (INST-42, stereo.ts): a node marked `stereo` is written once and runs per channel. It
 * is sugar, so the proof is that it compiles to exactly the plan the same device written out by hand
 * as a left and a right copy does.
 */

const params: ParamSchema = [
  { id: "rate", label: "Rate", kind: "number", min: 0.1, max: 5, default: 0.5 },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.5 },
];

/** A filter swept by one shared LFO, each channel its own LFO output, then dry/wet. */
const stereo = {
  format: 1,
  nodes: {
    lfo: { block: "lfo", inputs: { rate: { param: "rate" } } },
    sweep: {
      block: "pitch",
      stereo: true,
      inputs: {
        frequency: 800,
        semitones: { left: { from: "lfo.sine", scale: 12 }, right: { from: "lfo.triangle", scale: 12 } },
      },
    },
    filter: { block: "svf", stereo: true, inputs: { signal: "input", cutoff: "sweep" } },
    wet: { block: "mix", stereo: true, inputs: { dry: "input", wet: "filter.bandpass", mix: { param: "mix" } } },
  },
  output: "wet",
};

const byHand: DeviceDefinition = {
  format: 1,
  nodes: {
    lfo: { block: "lfo", inputs: { rate: { param: "rate" } } },
    sweep_left: { block: "pitch", inputs: { frequency: 800, semitones: { from: "lfo.sine", scale: 12 } } },
    sweep_right: { block: "pitch", inputs: { frequency: 800, semitones: { from: "lfo.triangle", scale: 12 } } },
    filter_left: { block: "svf", inputs: { signal: "input.left", cutoff: "sweep_left" } },
    filter_right: { block: "svf", inputs: { signal: "input.right", cutoff: "sweep_right" } },
    wet_left: { block: "mix", inputs: { dry: "input.left", wet: "filter_left.bandpass", mix: { param: "mix" } } },
    wet_right: { block: "mix", inputs: { dry: "input.right", wet: "filter_right.bandpass", mix: { param: "mix" } } },
  },
  output: ["wet_left", "wet_right"],
};

const problemsOf = (definition: unknown): string[] => {
  try {
    compileDefinition(definition, { params });
    return [];
  } catch (error) {
    if (error instanceof DefinitionError) return error.problems;
    throw error;
  }
};

describe("stereo nodes", () => {
  it("compile to the same plan as a left and a right copy written out by hand", () => {
    expect(compileDefinition(stereo, { params })).toEqual(compileDefinition(byHand, { params }));
  });

  it("read the voices on their own channel after an instrument's voices", () => {
    const instrument = {
      format: 1,
      nodes: {
        osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
        warm: { block: "shaper", stereo: true, inputs: { signal: "voices", drive: 3 } },
      },
      voice: "osc",
      output: "warm",
    };
    const plain = {
      format: 1,
      nodes: {
        osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
        warm_left: { block: "shaper", inputs: { signal: "voices.left", drive: 3 } },
        warm_right: { block: "shaper", inputs: { signal: "voices.right", drive: 3 } },
      },
      voice: "osc",
      output: ["warm_left", "warm_right"],
    };
    expect(compileDefinition(instrument)).toEqual(compileDefinition(plain));
  });

  it("let a shared node read one channel of a stereo node, by its copy's name", () => {
    const crossed = {
      ...stereo,
      nodes: { ...stereo.nodes, follow: { block: "onepole", inputs: { signal: "filter_left.lowpass" } } },
    };
    expect(problemsOf(crossed)).toEqual([]);
  });

  it("say what's wrong: a taken copy name, a shared node reading a stereo one, per-channel inputs on a shared node", () => {
    const wrong = {
      ...stereo,
      nodes: {
        ...stereo.nodes,
        filter_left: { block: "noise" },
        follow: { block: "onepole", inputs: { signal: "filter", cutoff: { left: 100, right: 200 } } },
      },
    };
    expect(problemsOf(wrong)).toEqual([
      "filter: its left copy would be named filter_left, which is taken",
      "follow.signal: filter is stereo, so read one channel: filter_left or filter_right",
      "follow.cutoff: { left, right } is for a stereo node",
    ]);
  });

  it("are made plain as a device registers, so chains only see plain nodes", () => {
    registerEngineDevice("ce-stereo-test", { schema: params, definition: stereo as DeviceDefinition });
    expect(engineDevice("ce-stereo-test")?.definition).toEqual(byHand);
    unregisterEngineDevice("ce-stereo-test");
  });
});
