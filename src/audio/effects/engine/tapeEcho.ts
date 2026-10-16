/**
 * Tape Echo (INST-42): a delay whose repeats wobble (wow, and a little flutter on top), saturate and
 * darken each time round, as a tape loop's do. Feedback past 1 runs away into the saturation.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const tapeEcho: EngineBuiltin = {
  type: "tape-echo",
  label: "Tape Echo",
  tags: ["space", "retro", "warm"],
  color: "blue",
  schema: [
    { id: "time", label: "Time", kind: "number", min: 40, max: 1200, default: 330, unit: "ms", taper: "exponential" },
    { id: "feedback", label: "Feedback", kind: "number", min: 0, max: 1.1, default: 0.55 },
    { id: "wow", label: "Wow", kind: "number", min: 0, max: 6, default: 1.5, unit: "ms" },
    { id: "drive", label: "Drive", kind: "number", min: 1, max: 8, default: 2, taper: "exponential" },
    {
      id: "tone",
      label: "Tone",
      kind: "number",
      min: 400,
      max: 12000,
      default: 3000,
      unit: "Hz",
      taper: "exponential",
    },
    { ...MIX, default: 0.35 },
  ],
  definition: {
    format: 1,
    nodes: {
      wowLfo: { block: "lfo", inputs: { rate: 0.7 } },
      flutterLfo: { block: "lfo", inputs: { rate: 6.3 } },
      // The wobble in samples, never below 0: Wow at most, a little flutter riding on it.
      wobble: {
        block: "mul",
        inputs: {
          a: ["wowLfo.sine", { from: "flutterLfo.sine", scale: 0.15 }, 1.15],
          b: { from: "host.sampleRate", scale: { param: "wow", scale: 0.0005 } },
        },
      },
      line: {
        block: "delay",
        stereo: true,
        inputs: {
          signal: ["input", { from: "back", scale: { param: "feedback" } }],
          length: ["wobble", { from: "host.sampleRate", scale: { param: "time", scale: 0.001 } }],
          size: 96000,
        },
      },
      saturated: { block: "shaper", stereo: true, inputs: { signal: "line", drive: { param: "drive" } } },
      back: { block: "onepole", stereo: true, inputs: { signal: "saturated", cutoff: { param: "tone" } } },
    },
    output: "back",
  },
};
