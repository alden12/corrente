/**
 * The arpeggiator in the MIDI format (INST-11.2), from parts: the keys stacked an octave a copy (each
 * copy past the first switched on by Octaves), a clock on the rate synced to the keys so it starts
 * with the first one when the transport is stopped, a pick walking what's held, and a length for the
 * gate. The same params as the TypeScript one it replaced (catalog.ts's arpeggiatorSchema), so a saved
 * project's arpeggiator plays the same.
 */
import { MIDI_FORMAT, type MidiDefinition } from "../format";

/** The most octaves the Octaves param reaches. */
const OCTAVES = 4;

export const arpeggiatorDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    octaves: {
      node: "stack",
      inputs: {
        notes: "keys",
        // Copy n is on once Octaves reaches n + 1: the table steps from off at n to on at n + 1.
        copies: Array.from({ length: OCTAVES }, (_, octave) => ({
          interval: 12 * octave,
          ...(octave > 0
            ? {
                on: {
                  param: "octaves",
                  table: [
                    [octave, 0],
                    [octave + 1, 1],
                  ],
                },
              }
            : {}),
        })),
      },
    },
    clock: { node: "clock", inputs: { sync: "keys", beats: { param: "rate" } } },
    arp: { node: "pick", inputs: { notes: "octaves", ticks: "clock", direction: { param: "pattern" } } },
    gate: { node: "length", inputs: { notes: "arp", scale: { param: "gate" } } },
  },
  output: "gate",
};
