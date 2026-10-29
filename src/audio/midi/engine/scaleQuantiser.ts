/**
 * The scale quantiser (DAW-12), first made by Claude over MCP and promoted to a built-in: `degrees`
 * with no steps, so every note lands in the song's key, a note outside it snapping to the nearest
 * note in it, or the one below or above.
 */
import { MIDI_FORMAT, type MidiDefinition } from "../format";

export const scaleQuantiserDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    inKey: { node: "degrees", inputs: { notes: "keys", steps: 0, snap: { param: "snap" } } },
  },
  output: "inKey",
};
