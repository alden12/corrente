/**
 * The arpeggiator in the MIDI format (INST-11.2): a clock on the rate, synced to the keys so it starts
 * with the first one when the transport is stopped, and a pick walking what's held. The same params
 * as the TypeScript one it replaces (catalog.ts's arpeggiatorSchema), so a saved project's
 * arpeggiator plays the same.
 */
import { MIDI_FORMAT, type MidiDefinition } from "../format";

export const arpeggiatorDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    clock: { node: "clock", inputs: { sync: "keys", beats: { param: "rate" } } },
    arp: {
      node: "pick",
      inputs: {
        notes: "keys",
        ticks: "clock",
        direction: { param: "pattern" },
        octaves: { param: "octaves" },
        gate: { param: "gate" },
      },
    },
  },
  output: "arp",
};
