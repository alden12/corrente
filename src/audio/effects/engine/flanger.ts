/**
 * Flanger (INST-42): the input added to a copy of itself a few milliseconds late, the delay swept by
 * an LFO and fed back, which sweeps a comb of peaks through the sound. Like the phaser, the sum is
 * the effect; Mix sets how much of it the chain lets through.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const flanger: EngineBuiltin = {
  type: "flanger",
  label: "Flanger",
  tags: ["fx", "retro"],
  schema: [
    { id: "rate", label: "Rate", kind: "number", min: 0.05, max: 5, default: 0.25, unit: "Hz", taper: "exponential" },
    { id: "delay", label: "Delay", kind: "number", min: 0.5, max: 10, default: 1.5, unit: "ms" },
    { id: "depth", label: "Depth", kind: "number", min: 0, max: 8, default: 3, unit: "ms" },
    { id: "feedback", label: "Feedback", kind: "number", min: -0.95, max: 0.95, default: 0.6 },
    { ...MIX, default: 1 },
  ],
  definition: {
    format: 1,
    nodes: {
      lfo: { block: "lfo", inputs: { rate: { param: "rate" } } },
      // The sweep in samples, 0 to Depth: each channel on its own shape.
      sweep: {
        block: "mul",
        stereo: true,
        inputs: {
          a: {
            left: { from: "lfo.triangle", scale: 0.5, offset: 0.5 },
            right: { from: "lfo.sine", scale: 0.5, offset: 0.5 },
          },
          b: { from: "host.sampleRate", scale: { param: "depth", scale: 0.001 } },
        },
      },
      line: {
        block: "delay",
        stereo: true,
        inputs: {
          signal: ["input", { from: "line", scale: { param: "feedback" } }],
          length: ["sweep", { from: "host.sampleRate", scale: { param: "delay", scale: 0.001 } }],
          size: 1024,
        },
      },
      combed: { block: "mix", stereo: true, inputs: { dry: "input", wet: "line", mix: 0.5 } },
    },
    output: "combed",
  },
};
