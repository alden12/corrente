/**
 * Widener (INST-42): Width turns the difference between the sides up (past 1) or down (0 is mono).
 * A mono sound has no difference to turn up, so Spread adds a short-delayed copy above 250 Hz, up on
 * one side and down on the other: wider, and it cancels exactly if the track is summed to mono.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const widener: EngineBuiltin = {
  type: "widener",
  label: "Widener",
  tags: ["space", "airy"],
  schema: [
    { id: "width", label: "Width", kind: "number", min: 0, max: 2, default: 1.4 },
    { id: "spread", label: "Spread", kind: "number", min: 0, max: 1, default: 0.5 },
    { id: "time", label: "Spread Time", kind: "number", min: 3, max: 30, default: 12, unit: "ms" },
    { ...MIX, default: 1 },
  ],
  definition: {
    format: 1,
    nodes: {
      late: {
        block: "delay",
        inputs: {
          signal: [
            { from: "input.left", scale: 0.5 },
            { from: "input.right", scale: 0.5 },
          ],
          length: { from: "host.sampleRate", scale: { param: "time", scale: 0.001 } },
          size: 2048,
        },
      },
      airy: { block: "biquad", inputs: { signal: "late", type: 1, frequency: 250, q: 0 } },
      wide: {
        block: "add",
        stereo: true,
        inputs: {
          a: { from: "input", scale: { param: "width", scale: 0.5, offset: 0.5 } },
          b: {
            left: [
              { from: "input.right", scale: { param: "width", scale: -0.5, offset: 0.5 } },
              { from: "airy", scale: { param: "spread" } },
            ],
            right: [
              { from: "input.left", scale: { param: "width", scale: -0.5, offset: 0.5 } },
              { from: "airy", scale: { param: "spread", scale: -1 } },
            ],
          },
        },
      },
    },
    output: "wide",
  },
};
