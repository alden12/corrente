/**
 * Pad (INST-42): three saws per voice, one each side of the note by Detune, through a low-pass every
 * voice shares a slow drift on (Motion), then chorus and reverb over them all.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const pad: EngineBuiltin = {
  type: "pad",
  label: "Pad",
  family: "Synths",
  tags: ["pad", "lush", "warm"],
  color: "blue",
  schema: [
    { id: "detune", label: "Detune", kind: "number", min: 0, max: 50, default: 14, unit: "ct" },
    {
      id: "cutoff",
      label: "Cutoff",
      kind: "number",
      min: 200,
      max: 12000,
      default: 1800,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "motion", label: "Motion", kind: "number", min: 0, max: 24, default: 7, unit: "st" },
    { id: "attack", label: "Attack", kind: "number", min: 0.01, max: 6, default: 1.2, unit: "s", taper: "exponential" },
    {
      id: "release",
      label: "Release",
      kind: "number",
      min: 0.05,
      max: 10,
      default: 2.5,
      unit: "s",
      taper: "exponential",
    },
    { id: "space", label: "Space", kind: "number", min: 0, max: 1, default: 0.35 },
    { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.5 },
  ],
  definition: {
    format: 1,
    voices: 10,
    nodes: {
      drift: { block: "lfo", inputs: { rate: 0.11 } },
      up: {
        block: "pitch",
        voice: true,
        inputs: { frequency: "voice.frequency", semitones: { param: "detune", scale: 0.01 } },
      },
      down: {
        block: "pitch",
        voice: true,
        inputs: { frequency: "voice.frequency", semitones: { param: "detune", scale: -0.01 } },
      },
      sawMid: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      sawUp: { block: "saw", voice: true, inputs: { frequency: "up" } },
      sawDown: { block: "saw", voice: true, inputs: { frequency: "down" } },
      cutoffHz: {
        block: "pitch",
        voice: true,
        inputs: { frequency: { param: "cutoff" }, semitones: { from: "drift.sine", scale: { param: "motion" } } },
      },
      filter: {
        block: "svf",
        voice: true,
        inputs: {
          signal: [
            { from: "sawMid", scale: 0.33 },
            { from: "sawUp", scale: 0.33 },
            { from: "sawDown", scale: 0.33 },
          ],
          cutoff: "cutoffHz",
          q: 0.9,
        },
      },
      env: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "attack" },
          decay: 0.5,
          sustain: 0.85,
          release: { param: "release" },
        },
      },
      amp: {
        block: "mul",
        voice: true,
        inputs: { a: "filter.lowpass", b: { from: "env", scale: { param: "level" } } },
      },
      wide: {
        block: "chorus",
        inputs: { left: "voices.left", right: "voices.right", rate: 0.4, depth: 0.6, delay: 15, mix: 0.5 },
      },
      room: {
        block: "reverb",
        inputs: {
          left: "wide.left",
          right: "wide.right",
          predelay: 30,
          decay: 4,
          damping: 5000,
          mix: { param: "space" },
        },
      },
    },
    voice: "amp",
    output: ["room.left", "room.right"],
  },
};
