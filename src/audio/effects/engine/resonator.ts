/**
 * Resonator (INST-42, from INST-36.7's test devices): each side a comb filter, a delay one period of
 * Pitch long fed back through a damping filter, ringing at that pitch and its harmonics for about
 * Decay (`loopgain`).
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const resonator: EngineBuiltin = {
  type: "resonator",
  label: "Resonator",
  tags: ["fx", "glassy"],
  color: "pink",
  schema: [
    { id: "pitch", label: "Pitch", kind: "number", min: 40, max: 2000, default: 220, unit: "Hz", taper: "exponential" },
    { id: "decay", label: "Decay", kind: "number", min: 0.05, max: 10, default: 1.5, unit: "s", taper: "exponential" },
    {
      id: "tone",
      label: "Tone",
      kind: "number",
      min: 500,
      max: 16000,
      default: 6000,
      unit: "Hz",
      taper: "exponential",
    },
    { ...MIX, default: 0.35 },
  ],
  definition: {
    format: 1,
    nodes: {
      period: { block: "period", inputs: { frequency: { param: "pitch" }, offset: 0.5 } },
      ring: { block: "loopgain", inputs: { period: "period", time: { param: "decay" } } },
      comb: {
        block: "delay",
        stereo: true,
        inputs: { signal: [{ from: "input", scale: 0.2 }, "back"], length: "period" },
      },
      damp: { block: "onepole", stereo: true, inputs: { signal: "comb", cutoff: { param: "tone" } } },
      back: { block: "mul", stereo: true, inputs: { a: "damp", b: "ring" } },
    },
    output: "comb",
  },
};
