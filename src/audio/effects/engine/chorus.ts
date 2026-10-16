/**
 * Chorus: a short delay per channel, its time wobbled by an LFO.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const chorusSchema: ParamSchema = [
  {
    id: "chorus.rate",
    label: "Rate",
    kind: "number",
    min: 0.05,
    max: 8,
    default: 1.2,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "chorus.depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear", smoothMs: 20 },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear", smoothMs: 20 },
] as const;

export const chorus: EngineBuiltin = {
  type: "chorus",
  label: "Chorus",
  tags: ["lush", "warm"],
  color: "green",
  schema: chorusSchema,
  definition: {
    format: 1,
    nodes: {
      delay_time: { block: "mul", inputs: { a: "lfoDepth", b: "host.sampleRate" } },
      delay: {
        block: "delay",
        stereo: true,
        inputs: { signal: "input", length: [{ from: "host.sampleRate", scale: 0.025 }, "delay_time"], size: 8161 },
      },
      lfo: { block: "sine", inputs: { frequency: { param: "chorus.rate" } } },
      lfoDepth: { block: "mul", inputs: { a: "lfo", b: { param: "chorus.depth", scale: 0.01 } } },
    },
    output: "delay",
  },
};
