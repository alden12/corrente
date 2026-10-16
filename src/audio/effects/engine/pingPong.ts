/**
 * Ping-Pong Delay (INST-42): the input, summed to mono, repeats on the left, then the right, then the
 * left, timed to the tempo, darkening each time round. Two delays feeding each other, so the loop
 * runs in chunks.
 */
import { DIVISIONS, MIX, type EngineBuiltin } from "../../definitions/builtin";

export const pingPong: EngineBuiltin = {
  type: "ping-pong",
  label: "Ping-Pong Delay",
  tags: ["space", "rhythm"],
  color: "cyan",
  schema: [
    { id: "division", label: "Time", kind: "enum", options: DIVISIONS, default: "1/8." },
    { id: "feedback", label: "Feedback", kind: "number", min: 0, max: 0.95, default: 0.5 },
    {
      id: "tone",
      label: "Tone",
      kind: "number",
      min: 500,
      max: 16000,
      default: 5000,
      unit: "Hz",
      taper: "exponential",
    },
    { ...MIX, default: 0.35 },
  ],
  definition: {
    format: 1,
    nodes: {
      left: {
        block: "delay",
        inputs: {
          signal: [
            { from: "input.left", scale: 0.5 },
            { from: "input.right", scale: 0.5 },
            { from: "damped", scale: { param: "feedback" } },
          ],
          length: { beats: { param: "division" }, as: "samples" },
          size: 480000,
        },
      },
      right: {
        block: "delay",
        inputs: { signal: "left", length: { beats: { param: "division" }, as: "samples" }, size: 480000 },
      },
      damped: { block: "onepole", inputs: { signal: "right", cutoff: { param: "tone" } } },
    },
    output: ["left", "right"],
  },
};
