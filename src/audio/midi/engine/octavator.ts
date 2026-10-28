/**
 * The octavator in the MIDI format (INST-11.1): each note, plus a copy an octave up and one an octave
 * down, each switched by its param, at `level`. The same params as the TypeScript one it replaces
 * (catalog.ts's octavatorSchema), so a saved project's octavator plays the same.
 */
import { MIDI_FORMAT, type MidiDefinition } from "../format";

export const octavatorDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    octaves: {
      node: "stack",
      inputs: {
        notes: "keys",
        copies: [
          { interval: 0 },
          { interval: 12, velocity: { param: "level" }, on: { param: "octaveUp" } },
          { interval: -12, velocity: { param: "level" }, on: { param: "octaveDown" } },
        ],
      },
    },
  },
  output: "octaves",
};
