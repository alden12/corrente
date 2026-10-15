/**
 * Tremolo: the level wobbled by an LFO.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const tremoloSchema: ParamSchema = [
  {
    id: "tremolo.rate",
    label: "Rate",
    kind: "number",
    min: 0.1,
    max: 16,
    default: 4,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "tremolo.depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0.6, taper: "linear", smoothMs: 20 },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export const tremolo: EngineBuiltin = {
  type: "tremolo",
  label: "Tremolo",
  tags: ["retro"],
  schema: tremoloSchema,
  definition: {
    format: 1,
    nodes: {
      vca: {
        block: "mul",
        stereo: true,
        inputs: { a: "input", b: [{ param: "tremolo.depth", scale: -0.5, offset: 1 }, "lfoDepth"] },
      },
      lfo: { block: "sine", inputs: { frequency: { param: "tremolo.rate" } } },
      lfoDepth: { block: "mul", inputs: { a: "lfo", b: { param: "tremolo.depth", scale: 0.5 } } },
    },
    output: "vca",
  },
};
