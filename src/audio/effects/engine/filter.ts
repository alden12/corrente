/**
 * Filter: one biquad per channel, its type a choice, swept by an LFO if you like.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const filterSchema: ParamSchema = [
  {
    id: "filter.cutoff",
    label: "Cutoff",
    kind: "number",
    min: 20,
    max: 18000,
    default: 2000,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 15,
  },
  {
    id: "filter.resonance",
    label: "Resonance",
    kind: "number",
    min: 0.0001,
    max: 24,
    default: 6,
    unit: "Q",
    taper: "linear",
    smoothMs: 15,
  },
  {
    id: "lfo.rate",
    label: "LFO Rate",
    kind: "number",
    min: 0.05,
    max: 20,
    default: 1,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "lfo.depth", label: "LFO Depth", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear", smoothMs: 20 },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 1, taper: "linear", smoothMs: 20 },
] as const;

export const filter: EngineBuiltin = {
  type: "filter",
  label: "Filter",
  tags: ["fx", "dark"],
  schema: filterSchema,
  definition: {
    format: 1,
    nodes: {
      filter_pitch: {
        block: "pitch",
        inputs: { frequency: { param: "filter.cutoff" }, semitones: { from: "lfoDepth", scale: 0.01 } },
      },
      filter: {
        block: "biquad",
        stereo: true,
        inputs: { signal: "input", type: 0, frequency: "filter_pitch", q: { param: "filter.resonance" }, gain: 0 },
      },
      lfo: { block: "sine", inputs: { frequency: { param: "lfo.rate" } } },
      lfoDepth: { block: "mul", inputs: { a: "lfo", b: { param: "lfo.depth", scale: 1200 } } },
    },
    output: "filter",
  },
};
