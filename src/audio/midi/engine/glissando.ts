/**
 * The glissando (INST-32): `slide` turns each note into a run from the note before it, every semitone
 * or every note of the song's key between them, then `delay` spreads the run out, each note one Speed
 * after the last. With When on legato, only notes played over a held key run, so a melody played
 * detached plays as it is.
 */
import { GLISSANDO_SPEEDS } from "../device/catalog";
import { beatsOf } from "../../definitions/references";
import { MIDI_FORMAT, type MidiDefinition } from "../format";

export const glissandoDefinition: MidiDefinition = {
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    run: {
      node: "slide",
      inputs: { notes: "keys", beats: { param: "speed" }, scale: { param: "scale" }, when: { param: "when" } },
    },
    // Each note of the run waits its place in it times Speed, in beats: the choice's index, read as its division.
    glide: {
      node: "delay",
      inputs: {
        notes: "run",
        beats: {
          per: "index",
          times: { param: "speed", table: GLISSANDO_SPEEDS.map((speed, index) => [index, beatsOf(speed)!]) },
        },
      },
    },
  },
  output: "glide",
};
