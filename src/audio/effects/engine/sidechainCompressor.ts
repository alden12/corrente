/**
 * Sidechain Compressor (INST-42, from INST-36.7's test devices): turned down by its key, the track's
 * sidechain input. Until a project can choose a key's track (DAW-63) nothing keys it, and its
 * sidechain is its own input (definitions/chain.ts), so it works as a plain compressor.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const sidechainCompressor: EngineBuiltin = {
  type: "sidechain-compressor",
  label: "Sidechain Compressor",
  tags: ["fx"],
  color: "amber",
  schema: [
    { id: "threshold", label: "Threshold", kind: "number", min: -60, max: 0, default: -24, unit: "dB" },
    { id: "ratio", label: "Ratio", kind: "number", min: 1, max: 20, default: 8 },
    {
      id: "attack",
      label: "Attack",
      kind: "number",
      min: 0.0001,
      max: 0.2,
      default: 0.005,
      unit: "s",
      taper: "exponential",
    },
    {
      id: "release",
      label: "Release",
      kind: "number",
      min: 0.01,
      max: 2,
      default: 0.2,
      unit: "s",
      taper: "exponential",
    },
    { ...MIX, default: 1 },
  ],
  definition: {
    format: 1,
    nodes: {
      squash: {
        block: "keyedcompressor",
        inputs: {
          left: "input.left",
          right: "input.right",
          keyLeft: "input.sidechainLeft",
          keyRight: "input.sidechainRight",
          threshold: { param: "threshold" },
          ratio: { param: "ratio" },
          attack: { param: "attack" },
          release: { param: "release" },
        },
      },
    },
    output: ["squash.left", "squash.right"],
  },
};
