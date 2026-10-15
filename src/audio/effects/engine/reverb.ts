/**
 * Reverb: the engine's algorithmic reverb. It was a convolution reverb (an impulse response)
 * before the new engine.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const reverbSchema: ParamSchema = [
  { id: "reverb.decay", label: "Decay", kind: "number", min: 0.1, max: 6, default: 2, unit: "s", taper: "exponential" },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear", smoothMs: 20 },
] as const;

export const reverb: EngineBuiltin = {
  type: "reverb",
  label: "Reverb",
  tags: ["space", "lush", "airy"],
  schema: reverbSchema,
  definition: {
    format: 1,
    nodes: {
      room: {
        block: "reverb",
        inputs: {
          left: "input.left",
          right: "input.right",
          predelay: 0,
          decay: { param: "reverb.decay", scale: 0.9 },
          mix: 1,
        },
      },
    },
    output: ["room.left", "room.right"],
  },
};
