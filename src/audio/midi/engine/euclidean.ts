/**
 * The Euclidean sequencer in the MIDI format (INST-11.2), from parts: a clock on the rate, a euclid
 * passing the onsets with their accent, a ratchet repeating each, a pick voicing them from what's held
 * (the whole chord, or walked like an arpeggio), and a length for the gate. The same params as the TypeScript one it replaces
 * (catalog.ts's euclideanSchema), so a saved project's sequencer plays the same.
 */
import { MIDI_FORMAT, type MidiDefinition } from "../format";

export const euclideanDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    clock: { node: "clock", inputs: { sync: "keys", beats: { param: "rate" } } },
    rhythm: {
      node: "euclid",
      inputs: {
        ticks: "clock",
        steps: { param: "steps" },
        pulses: { param: "pulses" },
        rotate: { param: "rotate" },
        accent: { param: "accent" },
      },
    },
    repeats: { node: "ratchet", inputs: { ticks: "rhythm", repeats: { param: "repeats" } } },
    voicing: { node: "pick", inputs: { notes: "keys", ticks: "repeats", direction: { param: "voicing" } } },
    gate: { node: "length", inputs: { notes: "voicing", scale: { param: "gate" } } },
  },
  output: "gate",
};
