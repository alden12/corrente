/**
 * Ensemble (INST-42): two choruses at once, a slow deep one and a fast shallow one, as the string
 * machines' ensemble effect did: a thick, shimmering widening.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const ensemble: EngineBuiltin = {
  type: "ensemble",
  label: "Ensemble",
  tags: ["lush", "warm", "retro"],
  color: "green",
  schema: [
    { id: "depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0.6 },
    { ...MIX, default: 0.6 },
  ],
  definition: {
    format: 1,
    nodes: {
      slow: {
        block: "chorus",
        inputs: { left: "input.left", right: "input.right", rate: 0.6, depth: { param: "depth" }, delay: 14, mix: 1 },
      },
      fast: {
        block: "chorus",
        inputs: {
          left: "input.left",
          right: "input.right",
          rate: 4.8,
          depth: { param: "depth", scale: 0.25 },
          delay: 9,
          mix: 1,
        },
      },
      both: {
        block: "mix",
        stereo: true,
        inputs: {
          dry: { left: "slow.left", right: "slow.right" },
          wet: { left: "fast.left", right: "fast.right" },
          mix: 0.5,
        },
      },
    },
    output: "both",
  },
};
