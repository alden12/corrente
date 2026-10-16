/**
 * Pump (INST-42): the level moved in time with the beat: Duck dips at each beat and swells back, as a
 * sidechained kick would; Gate chops each division in half; Swell rises through it. Smooth eases the
 * edges.
 */
import { MIX, type EngineBuiltin } from "../../definitions/builtin";

export const pump: EngineBuiltin = {
  type: "pump",
  label: "Pump",
  tags: ["rhythm", "fx"],
  color: "amber",
  schema: [
    { id: "shape", label: "Shape", kind: "enum", options: ["Duck", "Gate", "Swell"], default: "Duck" },
    { id: "division", label: "Division", kind: "enum", options: ["1/16", "1/8", "1/4", "1/2", "1/1"], default: "1/4" },
    { id: "depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0.8 },
    { id: "smooth", label: "Smooth", kind: "number", min: 5, max: 400, default: 60, unit: "Hz", taper: "exponential" },
    { ...MIX, default: 1 },
  ],
  definition: {
    format: 1,
    nodes: {
      beat: { block: "beatlfo", inputs: { beat: "host.beat", length: { beats: { param: "division" }, as: "beats" } } },
      curve: {
        block: "select",
        inputs: {
          index: { param: "shape" },
          a: "beat.saw",
          b: { from: "beat.square", scale: -1 },
          c: { from: "beat.saw", scale: -1 },
          d: 0,
        },
      },
      // 1 at the curve's top, down by Depth at its bottom.
      level: {
        block: "add",
        inputs: {
          a: { from: "curve", scale: { param: "depth", scale: 0.5 } },
          b: { param: "depth", scale: -0.5, offset: 1 },
        },
      },
      eased: { block: "onepole", inputs: { signal: "level", cutoff: { param: "smooth" } } },
      pumped: { block: "mul", stereo: true, inputs: { a: "input", b: "eased" } },
    },
    output: "pumped",
  },
};
