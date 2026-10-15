/**
 * Lo-Fi (INST-42): fewer bits and a lower sample rate (the crunch), a slow wobble in pitch (worn
 * tape), a little hiss, and the top end rolled off.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const lofi: EngineBuiltin = {
  type: "lofi",
  label: "Lo-Fi",
  tags: ["gritty", "retro", "warm"],
  schema: [
    { id: "bits", label: "Bits", kind: "number", min: 3, max: 16, default: 10, step: 1 },
    { id: "downsample", label: "Downsample", kind: "number", min: 1, max: 20, default: 3, step: 1 },
    { id: "wow", label: "Wow", kind: "number", min: 0, max: 4, default: 1, unit: "ms" },
    {
      id: "tone",
      label: "Tone",
      kind: "number",
      min: 800,
      max: 16000,
      default: 5000,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "hiss", label: "Hiss", kind: "number", min: 0, max: 0.1, default: 0.015 },
    { ...MIX, default: 1 },
  ],
  definition: {
    format: 1,
    nodes: {
      wowLfo: { block: "lfo", inputs: { rate: 0.5 } },
      // The wobble in samples, never below 0.
      wobble: {
        block: "mul",
        inputs: {
          a: { from: "wowLfo.sine", offset: 1.2 },
          b: { from: "host.sampleRate", scale: { param: "wow", scale: 0.0005 } },
        },
      },
      crushed: {
        block: "bitcrush",
        stereo: true,
        inputs: { signal: "input", bits: { param: "bits" }, downsample: { param: "downsample" } },
      },
      worn: { block: "delay", stereo: true, inputs: { signal: "crushed", length: ["wobble", 2], size: 1024 } },
      hissing: { block: "pinknoise" },
      dull: {
        block: "biquad",
        stereo: true,
        inputs: {
          signal: ["worn", { from: "hissing", scale: { param: "hiss" } }],
          type: 0,
          frequency: { param: "tone" },
          q: 0,
        },
      },
    },
    output: "dull",
  },
};
