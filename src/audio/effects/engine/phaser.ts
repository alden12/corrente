/**
 * Phaser (INST-42): four all-pass filters swept by an LFO, added back to the input, which cuts moving
 * notches in the sound. The sum is the effect, so it's made here at half and half; Mix sets how much
 * of it the chain lets through. The two channels sweep on different shapes, so it moves across too.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

const allpass = (signal: string) => ({
  block: "biquad",
  stereo: true,
  inputs: { signal, type: 7, frequency: "sweep", q: { param: "resonance" } },
});

export const phaser: EngineBuiltin = {
  type: "phaser",
  label: "Phaser",
  tags: ["fx", "retro"],
  color: "lime",
  schema: [
    { id: "rate", label: "Rate", kind: "number", min: 0.05, max: 5, default: 0.4, unit: "Hz", taper: "exponential" },
    { id: "depth", label: "Depth", kind: "number", min: 0, max: 48, default: 30, unit: "st" },
    {
      id: "center",
      label: "Center",
      kind: "number",
      min: 100,
      max: 4000,
      default: 700,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "resonance", label: "Resonance", kind: "number", min: 0.3, max: 8, default: 0.7, taper: "exponential" },
    { ...MIX, default: 1 },
  ],
  definition: {
    format: 1,
    nodes: {
      lfo: { block: "lfo", inputs: { rate: { param: "rate" } } },
      sweep: {
        block: "pitch",
        stereo: true,
        inputs: {
          frequency: { param: "center" },
          semitones: {
            left: { from: "lfo.sine", scale: { param: "depth", scale: 0.5 } },
            right: { from: "lfo.triangle", scale: { param: "depth", scale: 0.5 } },
          },
        },
      },
      stage1: allpass("input"),
      stage2: allpass("stage1"),
      stage3: allpass("stage2"),
      stage4: allpass("stage3"),
      notched: { block: "mix", stereo: true, inputs: { dry: "input", wet: "stage4", mix: 0.5 } },
    },
    output: "notched",
  },
};
