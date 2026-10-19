/**
 * Hybrid Wave: after the PPG Wave's idea of digital wavetables through an analogue-style filter.
 * Each voice plays a wavetable whose position a decaying envelope sweeps (Morph Env), so the timbre
 * moves as a note plays, beside a pulse whose width an LFO wobbles (PWM); both go through a ladder
 * low-pass opened by its own snappy envelope, and velocity can open it further.
 *
 * Promoted from the "Block Test Synth", a custom device built to try out the engine's blocks
 * (converted to the new engine on 2026-10-15), which Alden liked the sound of.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const hybridWave: EngineBuiltin = {
  type: "hybrid-wave",
  label: "Hybrid Wave",
  family: "Synths",
  tags: ["keys", "glassy", "retro"],
  color: "pink",
  schema: [
    { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.6 },
    { id: "mix.pwm", label: "PWM Level", kind: "number", min: 0, max: 1, default: 0.6 },
    { id: "mix.wt", label: "Wavetable Level", kind: "number", min: 0, max: 1, default: 0.5 },
    { id: "pwm.width", label: "Pulse Width", kind: "number", min: 0.05, max: 0.95, default: 0.5 },
    { id: "pwm.depth", label: "PWM Depth", kind: "number", min: 0, max: 0.45, default: 0.3 },
    {
      id: "pwm.rate",
      label: "PWM Rate",
      kind: "number",
      min: 0.05,
      max: 10,
      default: 0.8,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "wt.table", label: "Wavetable", kind: "sample", default: "wavetable:classic", wavetable: true },
    { id: "wt.position", label: "Position", kind: "number", min: 0, max: 1, default: 0.2 },
    { id: "wt.env", label: "Morph Env", kind: "number", min: 0, max: 1, default: 0.6 },
    {
      id: "morph.decay",
      label: "Morph Decay",
      kind: "number",
      min: 10,
      max: 5000,
      default: 800,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "filter.cutoff",
      label: "Cutoff",
      kind: "number",
      min: 40,
      max: 12000,
      default: 500,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "filter.resonance", label: "Resonance", kind: "number", min: 0, max: 1.1, default: 0.55 },
    { id: "filter.env", label: "Filter Env", kind: "number", min: 0, max: 48, default: 30, unit: "st" },
    {
      id: "fenv.decay",
      label: "Filter Decay",
      kind: "number",
      min: 10,
      max: 3000,
      default: 350,
      unit: "ms",
      taper: "exponential",
    },
    { id: "filter.vel", label: "Velocity > Cutoff", kind: "number", min: 0, max: 24, default: 0, unit: "st" },
    {
      id: "env.attack",
      label: "Attack",
      kind: "number",
      min: 1,
      max: 2000,
      default: 5,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "env.decay",
      label: "Decay",
      kind: "number",
      min: 1,
      max: 4000,
      default: 600,
      unit: "ms",
      taper: "exponential",
    },
    { id: "env.sustain", label: "Sustain", kind: "number", min: 0, max: 1, default: 0.6 },
    {
      id: "env.release",
      label: "Release",
      kind: "number",
      min: 1,
      max: 4000,
      default: 400,
      unit: "ms",
      taper: "exponential",
    },
  ],
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      // The wavetable, its position swept by a decaying envelope.
      morphEnv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.001,
          decay: { param: "morph.decay", scale: 0.001 },
          sustain: 0,
          release: 0.2,
        },
      },
      morphDepth: { block: "mul", voice: true, inputs: { a: "morphEnv", b: { param: "wt.env" } } },
      wt: {
        block: "wavetable",
        voice: true,
        inputs: {
          table: { param: "wt.table" },
          position: [{ param: "wt.position" }, "morphDepth"],
          frequency: "voice.frequency",
        },
      },
      wtLevel: { block: "mul", voice: true, inputs: { a: "wt", b: { param: "mix.wt" } } },

      // The pulse, its width wobbled by an LFO.
      lfo: { block: "sine", voice: true, inputs: { frequency: { param: "pwm.rate" } } },
      lfoDepth: { block: "mul", voice: true, inputs: { a: "lfo", b: { param: "pwm.depth" } } },
      pwm: {
        block: "pulse",
        voice: true,
        inputs: { width: [{ param: "pwm.width" }, "lfoDepth"], frequency: "voice.frequency" },
      },
      pwmLevel: { block: "mul", voice: true, inputs: { a: "pwm", b: { param: "mix.pwm" } } },

      // Both through a ladder low-pass, opened by its envelope and by velocity, in semitones.
      filterEnv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.002,
          decay: { param: "fenv.decay", scale: 0.001 },
          sustain: 0,
          release: 0.2,
        },
      },
      filterDepth: { block: "mul", voice: true, inputs: { a: "filterEnv", b: { param: "filter.env" } } },
      filter_pitch: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: { param: "filter.cutoff" },
          semitones: ["filterDepth", { from: "voice.velocity", scale: { param: "filter.vel" } }],
        },
      },
      filter: {
        block: "ladder",
        voice: true,
        inputs: {
          signal: ["pwmLevel", "wtLevel"],
          cutoff: "filter_pitch",
          resonance: { param: "filter.resonance" },
        },
      },

      ampEnv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "env.attack", scale: 0.001 },
          decay: { param: "env.decay", scale: 0.001 },
          sustain: { param: "env.sustain" },
          release: { param: "env.release", scale: 0.001 },
        },
      },
      vca: { block: "mul", voice: true, inputs: { a: "filter", b: "ampEnv" } },

      level_l: { block: "mul", inputs: { a: "voices.left", b: { param: "amp.level" } } },
      level_r: { block: "mul", inputs: { a: "voices.right", b: { param: "amp.level" } } },
    },
    voice: "vca",
    output: ["level_l", "level_r"],
  },
};
