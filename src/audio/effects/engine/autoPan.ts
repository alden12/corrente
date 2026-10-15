/**
 * Auto-Pan (INST-42): the sound swung from side to side by an LFO, free-running or (Sync on) locked to
 * the beat. Depth 1 swings it all the way out of each side.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const autoPan: EngineBuiltin = {
  type: "auto-pan",
  label: "Auto-Pan",
  tags: ["fx", "rhythm"],
  schema: [
    { id: "sync", label: "Sync", kind: "boolean", default: true },
    {
      id: "division",
      label: "Division",
      kind: "enum",
      options: ["1/16", "1/8", "1/4", "1/2", "1/1", "2/1"],
      default: "1/2",
    },
    { id: "rate", label: "Rate", kind: "number", min: 0.05, max: 10, default: 1, unit: "Hz", taper: "exponential" },
    { id: "depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0.8 },
    { ...MIX, default: 1 },
  ],
  definition: {
    format: 1,
    nodes: {
      free: { block: "lfo", inputs: { rate: { param: "rate" } } },
      synced: {
        block: "beatlfo",
        inputs: { beat: "host.beat", length: { beats: { param: "division" }, as: "beats" } },
      },
      wave: { block: "select", inputs: { index: { param: "sync" }, a: "free.sine", b: "synced.sine", c: 0, d: 0 } },
      // Each side's level: 1 at its peak, down by Depth at the other side's, the wave the other way up.
      level: {
        block: "add",
        stereo: true,
        inputs: {
          a: {
            left: { from: "wave", scale: { param: "depth", scale: 0.5 } },
            right: { from: "wave", scale: { param: "depth", scale: -0.5 } },
          },
          b: { param: "depth", scale: -0.5, offset: 1 },
        },
      },
      panned: { block: "mul", stereo: true, inputs: { a: "input", b: "level" } },
    },
    output: "panned",
  },
};
