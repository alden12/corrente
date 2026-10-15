/**
 * Distortion: a waveshaper driven by `drive`, with a tone filter after it.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const distortionSchema: ParamSchema = [
  {
    id: "dist.drive",
    label: "Drive",
    kind: "number",
    min: 1,
    max: 100,
    default: 20,
    taper: "exponential",
    smoothMs: 20,
  },
  {
    id: "dist.tone",
    label: "Tone",
    kind: "number",
    min: 200,
    max: 12000,
    default: 6000,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export const distortion: EngineBuiltin = {
  type: "distortion",
  label: "Distortion",
  tags: ["gritty", "aggressive"],
  schema: distortionSchema,
  definition: {
    format: 1,
    nodes: {
      shaper: {
        block: "waveshaper",
        stereo: true,
        inputs: { signal: "input", shape: 0, amount: { param: "dist.drive" } },
      },
      tone: {
        block: "biquad",
        stereo: true,
        inputs: { signal: "shaper", type: 0, frequency: { param: "dist.tone" }, q: 1, gain: 0 },
      },
    },
    output: "tone",
  },
};
