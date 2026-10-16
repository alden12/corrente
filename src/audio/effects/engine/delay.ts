/**
 * Delay: a feedback delay, each channel repeating itself.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const delaySchema: ParamSchema = [
  {
    id: "delay.time",
    label: "Time",
    kind: "number",
    min: 0.01,
    max: 1.5,
    default: 0.3,
    unit: "s",
    taper: "linear",
    smoothMs: 60,
  },
  {
    id: "delay.feedback",
    label: "Feedback",
    kind: "number",
    min: 0,
    max: 0.95,
    default: 0.35,
    taper: "linear",
    smoothMs: 20,
  },
  { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear", smoothMs: 20 },
] as const;

export const delay: EngineBuiltin = {
  type: "delay",
  label: "Delay",
  tags: ["space"],
  color: "blue",
  schema: delaySchema,
  definition: {
    format: 1,
    nodes: {
      delay: {
        block: "delay",
        stereo: true,
        inputs: {
          signal: ["input", "feedback"],
          length: { from: "host.sampleRate", scale: { param: "delay.time" } },
          size: 192000,
        },
      },
      feedback: { block: "mul", stereo: true, inputs: { a: "delay", b: { param: "delay.feedback" } } },
    },
    output: "delay",
  },
};
