/**
 * Bitcrusher: fewer bits and a lower sample rate, for grit.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const bitcrusherSchema: ParamSchema = [
  {
    id: "bits",
    label: "Bits",
    kind: "number",
    min: 1,
    max: 16,
    default: 8,
    unit: "bit",
    taper: "linear",
    smoothMs: 20,
  },
  {
    id: "downsample",
    label: "Downsample",
    kind: "number",
    min: 1,
    max: 50,
    default: 4,
    unit: "×",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export const bitcrusher: EngineBuiltin = {
  type: "bitcrusher",
  label: "Bitcrusher",
  tags: ["gritty", "retro"],
  schema: bitcrusherSchema,
  definition: {
    format: 1,
    nodes: {
      crush: {
        block: "bitcrush",
        stereo: true,
        inputs: { signal: "input", bits: { param: "bits" }, downsample: { param: "downsample" } },
      },
    },
    output: "crush",
  },
};
