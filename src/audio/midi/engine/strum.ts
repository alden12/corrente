/**
 * The strum (INST-35), first made by Claude over MCP from parts and promoted to a built-in: `order`
 * numbers a chord's notes up, down or alternately, `delay` plays each one `spread` beats after the
 * last, and `velocity` tilts them louder or quieter as they go. No node of its own.
 */
import { MIDI_FORMAT, type MidiDefinition } from "../format";

export const strumDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    chord: { node: "order", inputs: { notes: "keys", direction: { param: "direction" } } },
    strum: { node: "delay", inputs: { notes: "chord", beats: { per: "index", times: { param: "spread" } } } },
    fade: { node: "velocity", inputs: { notes: "strum", scale: { per: "index", times: { param: "tilt" }, plus: 1 } } },
  },
  output: "fade",
};
