/**
 * Gate Pad (INST-45's demo, made over MCP and promoted): two detuned saws through a ladder filter that
 * bounces (an LFO folded with `abs`, its sweep held in range by `clip`, `min` and `max`), chopped by a
 * trance gate: a rising saw `compare`d with Gate Length opens it at the start of every step, for that
 * much of it. With Sync on, a step is a note division, locked to the beat; off, Gate Rate in Hz.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const gatePad: EngineBuiltin = {
  type: "gate-pad",
  label: "Gate Pad",
  family: "Synths",
  tags: ["pad", "rhythm", "lush"],
  color: "violet",
  schema: [
    { id: "gate.sync", label: "Sync", kind: "boolean", default: true },
    {
      id: "gate.division",
      label: "Division",
      kind: "enum",
      options: ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"],
      default: "1/16",
    },
    { id: "gate.rate", label: "Rate", kind: "number", min: 1, max: 16, default: 8, unit: "Hz" },
    { id: "gate.length", label: "Length", kind: "number", min: 0.05, max: 0.95, default: 0.5 },
    { id: "gate.depth", label: "Depth", kind: "number", min: 0, max: 1, default: 1 },
    { id: "bounce.rate", label: "Rate", kind: "number", min: 0.1, max: 4, default: 0.5, unit: "Hz" },
    { id: "bounce.depth", label: "Depth", kind: "number", min: 0, max: 48, default: 30, unit: "st" },
    {
      id: "f.cutoff",
      label: "Cutoff",
      kind: "number",
      min: 100,
      max: 8000,
      default: 500,
      unit: "Hz",
      taper: "exponential",
      smoothMs: 20,
    },
    { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
  ],
  definition: {
    format: 1,
    voices: 8,
    nodes: {
      // The gate's step: free in Hz, or with Sync on, a note division locked to the beat.
      free: { block: "lfo", inputs: { rate: { param: "gate.rate" } } },
      locked: {
        block: "beatlfo",
        inputs: { beat: "host.beat", length: { beats: { param: "gate.division" }, as: "beats" } },
      },
      step: { block: "select", inputs: { index: { param: "gate.sync" }, a: "free.saw", b: "locked.saw" } },
      // Open while the step's saw is under Length's share of its rise: from the step's start, for that much of it.
      gate: {
        block: "compare",
        inputs: { a: { param: "gate.length", scale: 2, offset: -1 }, b: "step" },
      },
      // Softened, so the chop doesn't click; Depth 0 leaves the pad unchopped.
      smooth: { block: "onepole", inputs: { signal: "gate", cutoff: 150 } },
      gain: {
        block: "add",
        inputs: {
          a: { from: "smooth", scale: { param: "gate.depth" } },
          b: { param: "gate.depth", scale: -1, offset: 1 },
        },
      },
      // The filter bounces: an LFO folded to rise twice a cycle, its sweep and the cutoff kept in range.
      wobble: { block: "lfo", inputs: { rate: { param: "bounce.rate" } } },
      bounce: { block: "abs", inputs: { signal: "wobble.sine" } },
      capped: {
        block: "clip",
        inputs: { signal: { from: "bounce", scale: { param: "bounce.depth" } }, low: 0, high: 36 },
      },
      fcut: { block: "pitch", inputs: { frequency: { param: "f.cutoff" }, semitones: "capped" } },
      ceiling: { block: "min", inputs: { a: "fcut", b: 12000 } },
      floor: { block: "max", inputs: { a: "ceiling", b: 80 } },
      s1: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      p2: { block: "pitch", voice: true, inputs: { frequency: "voice.frequency", semitones: 0.1 } },
      s2: { block: "saw", voice: true, inputs: { frequency: "p2" } },
      mix: { block: "add", voice: true, inputs: { a: "s1", b: "s2" } },
      lad: {
        block: "ladder",
        voice: true,
        inputs: { signal: { from: "mix", scale: 0.5 }, cutoff: "floor", resonance: 0.35 },
      },
      aenv: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.2, decay: 0.5, sustain: 0.8, release: 0.8 },
      },
      vca: { block: "mul", voice: true, inputs: { a: "lad", b: { from: "aenv", scale: { param: "amp.level" } } } },
      chop: { block: "mul", stereo: true, inputs: { a: "voices", b: "gain" } },
    },
    voice: "vca",
    output: ["chop_left", "chop_right"],
  },
};
