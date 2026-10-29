/**
 * The harmoniser (DAW-12), first made by Claude over MCP and promoted to a built-in: a `stack` of
 * three plain copies (the second at `level`, the third switched on by `voices`), then `degrees`
 * moving copy n by n times the interval in the song's key (a 3rd is 2 degrees, so two voices make a
 * triad), then `range` folding the harmony into `low` to `high`.
 */
import { MIDI_FORMAT, type MidiDefinition } from "../format";

export const harmoniserDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    copies: {
      node: "stack",
      inputs: {
        notes: "keys",
        copies: [
          { interval: 0 },
          { interval: 0, velocity: { param: "level" } },
          // Voices is "1" or "2": its index, 0 or 1, through the table, switches the third copy.
          {
            interval: 0,
            velocity: { param: "level" },
            on: {
              param: "voices",
              table: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        ],
      },
    },
    // Interval is 3rd to 6th: its index, 0 to 3, through the table, is 2 to 5 degrees.
    harmony: {
      node: "degrees",
      inputs: {
        notes: "copies",
        steps: {
          per: "index",
          times: {
            param: "interval",
            table: [
              [0, 2],
              [3, 5],
            ],
          },
        },
      },
    },
    fit: { node: "range", inputs: { notes: "harmony", low: { param: "low" }, high: { param: "high" } } },
  },
  output: "fit",
};
