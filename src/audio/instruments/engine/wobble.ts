/**
 * Wobble (INST-42, from INST-36.5's test devices): a saw, square or sine (a choice, through
 * `select`) through a filter every voice shares one LFO on, free in Hz or (Sync on) locked to the
 * beat, a cycle per note division, into a reverb on the voices summed.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const wobble: EngineBuiltin = {
  type: "wobble",
  label: "Wobble",
  family: "Bass",
  tags: ["bass", "aggressive", "rhythm"],
  schema: [
    { id: "wave", label: "Wave", kind: "enum", options: ["Saw", "Square", "Sine"], default: "Saw" },
    {
      id: "cutoff",
      label: "Cutoff",
      kind: "number",
      min: 40,
      max: 8000,
      default: 900,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "resonance", label: "Resonance", kind: "number", min: 0.5, max: 12, default: 3, taper: "linear" },
    { id: "wobble", label: "Wobble", kind: "number", min: 0, max: 36, default: 18, unit: "st", taper: "linear" },
    { id: "sync", label: "Sync", kind: "boolean", default: true },
    { id: "hz", label: "Rate", kind: "number", min: 0.1, max: 12, default: 2, unit: "Hz", taper: "exponential" },
    {
      id: "division",
      label: "Division",
      kind: "enum",
      options: ["1/1", "1/2", "1/2.", "1/4", "1/4.", "1/4T", "1/8", "1/8.", "1/8T", "1/16"],
      default: "1/4",
    },
    { id: "attack", label: "Attack", kind: "number", min: 1, max: 2000, default: 5, unit: "ms", taper: "exponential" },
    {
      id: "release",
      label: "Release",
      kind: "number",
      min: 5,
      max: 4000,
      default: 300,
      unit: "ms",
      taper: "exponential",
    },
    { id: "reverb", label: "Reverb", kind: "number", min: 0, max: 1, default: 0.25, taper: "linear" },
  ],
  definition: {
    format: 1,
    nodes: {
      // Free in Hz, or with Sync on, locked to the beat: one cycle per note division, in the same
      // place every time play starts.
      free: { block: "lfo", inputs: { rate: { param: "hz" } } },
      locked: {
        block: "beatlfo",
        inputs: { beat: "host.beat", length: { beats: { param: "division" }, as: "beats" } },
      },
      lfo: {
        block: "select",
        inputs: { index: { param: "sync" }, a: "free.sine", b: "locked.sine", c: 0, d: 0 },
      },
      saw: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      // A pulse at half width is a square, between -1 and 1.
      square: { block: "pulse", voice: true, inputs: { frequency: "voice.frequency", width: 0.5 } },
      sine: { block: "sine", voice: true, inputs: { frequency: "voice.frequency" } },
      osc: {
        block: "select",
        voice: true,
        inputs: { index: { param: "wave" }, a: "saw", b: "square", c: "sine", d: 0 },
      },
      envelope: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "attack", scale: 0.001 },
          release: { param: "release", scale: 0.001 },
          sustain: 0.8,
        },
      },
      cutoff: {
        block: "pitch",
        voice: true,
        inputs: { frequency: { param: "cutoff" }, semitones: { from: "lfo", scale: { param: "wobble" } } },
      },
      filter: { block: "svf", voice: true, inputs: { signal: "osc", cutoff: "cutoff", q: { param: "resonance" } } },
      amp: { block: "mul", voice: true, inputs: { a: "filter.lowpass", b: "envelope" } },
      // Resonance lifts the filter's peak well past 1: down to leave room for chords.
      level: { block: "mul", voice: true, inputs: { a: "amp", b: 0.35 } },
      verb: { block: "reverb", inputs: { left: "voices.left", right: "voices.right", mix: { param: "reverb" } } },
    },
    voice: "level",
    output: ["verb.left", "verb.right"],
  },
};
