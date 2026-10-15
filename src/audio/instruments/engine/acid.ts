/**
 * Acid (INST-42): a saw or square through a resonant ladder low-pass swept by a short envelope, which
 * a harder note sweeps further, then a little drive. Two voices, for overlapping slides of notes.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const acid: EngineBuiltin = {
  type: "acid",
  label: "Acid",
  family: "Bass",
  tags: ["bass", "lead", "gritty", "retro"],
  schema: [
    { id: "wave", label: "Wave", kind: "enum", options: ["Saw", "Square"], default: "Saw" },
    {
      id: "cutoff",
      label: "Cutoff",
      kind: "number",
      min: 60,
      max: 4000,
      default: 300,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "resonance", label: "Resonance", kind: "number", min: 0, max: 0.97, default: 0.7 },
    { id: "envAmount", label: "Env Mod", kind: "number", min: 0, max: 60, default: 36, unit: "st" },
    { id: "decay", label: "Decay", kind: "number", min: 0.05, max: 2, default: 0.25, unit: "s", taper: "exponential" },
    { id: "drive", label: "Drive", kind: "number", min: 1, max: 10, default: 2.5, taper: "exponential" },
    { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.6 },
  ],
  definition: {
    format: 1,
    voices: 2,
    nodes: {
      saw: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      square: { block: "pulse", voice: true, inputs: { frequency: "voice.frequency", width: 0.5 } },
      osc: {
        block: "select",
        voice: true,
        inputs: { index: { param: "wave" }, a: "saw", b: { from: "square", scale: 0.7 }, c: 0, d: 0 },
      },
      filterEnv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.002,
          decay: { param: "decay" },
          sustain: 0,
          release: { param: "decay" },
        },
      },
      // How far the envelope opens the filter, in semitones: Env Mod, by how hard the note was played.
      sweep: {
        block: "mul",
        voice: true,
        inputs: { a: "filterEnv", b: { from: "voice.velocity", scale: { param: "envAmount" } } },
      },
      cutoffHz: { block: "pitch", voice: true, inputs: { frequency: { param: "cutoff" }, semitones: "sweep" } },
      filter: {
        block: "ladder",
        voice: true,
        inputs: { signal: "osc", cutoff: "cutoffHz", resonance: { param: "resonance" } },
      },
      dirt: {
        block: "shaper",
        voice: true,
        inputs: { signal: { from: "filter", scale: 0.5 }, drive: { param: "drive" } },
      },
      ampEnv: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.002, decay: 0.3, sustain: 0.7, release: 0.03 },
      },
      amp: { block: "mul", voice: true, inputs: { a: "dirt", b: { from: "ampEnv", scale: { param: "level" } } } },
    },
    voice: "amp",
  },
};
