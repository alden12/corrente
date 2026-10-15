/**
 * Subtractive: one oscillator (sine, saw, square or triangle) through a resonant low-pass per voice,
 * with an envelope for the amp and one for the cutoff. The default instrument. Its saw and square
 * play at 0.849, Web Audio's level for them, which it was voiced on.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

const WAVEFORMS = ["sine", "sawtooth", "square", "triangle"] as const;

export const subtractiveSchema: ParamSchema = [
  { id: "osc.waveform", label: "Waveform", kind: "enum", options: WAVEFORMS, default: "sawtooth" },
  {
    id: "osc.detune",
    label: "Detune",
    kind: "number",
    min: -100,
    max: 100,
    default: 0,
    unit: "cents",
    taper: "linear",
    smoothMs: 20,
  },
  {
    id: "filter.cutoff",
    label: "Cutoff",
    kind: "number",
    min: 20,
    max: 20000,
    default: 4000,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 15,
  },
  {
    id: "filter.resonance",
    label: "Resonance",
    kind: "number",
    min: 0.0001,
    max: 24,
    default: 1,
    unit: "Q",
    taper: "linear",
    smoothMs: 15,
  },
  // The filter envelope (INST-12): how far it opens the cutoff, in semitones, and its own ADSR.
  // At 0 it does nothing, which is where every project made before it was added sits.
  {
    id: "filter.env",
    label: "Env Amount",
    kind: "number",
    min: -48,
    max: 48,
    default: 0,
    unit: "st",
    taper: "linear",
    smoothMs: 15,
  },
  {
    id: "fenv.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 5,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "fenv.decay",
    label: "Decay",
    kind: "number",
    min: 1,
    max: 4000,
    default: 300,
    unit: "ms",
    taper: "exponential",
  },
  { id: "fenv.sustain", label: "Sustain", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
  {
    id: "fenv.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 200,
    unit: "ms",
    taper: "exponential",
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8, taper: "linear", smoothMs: 10 },
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
  // Decay and sustain joined attack and release with INST-12; full sustain is the old
  // attack/release shape exactly.
  {
    id: "env.decay",
    label: "Decay",
    kind: "number",
    min: 1,
    max: 4000,
    default: 200,
    unit: "ms",
    taper: "exponential",
  },
  { id: "env.sustain", label: "Sustain", kind: "number", min: 0, max: 1, default: 1, taper: "linear" },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 200,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const subtractive: EngineBuiltin = {
  type: "subtractive",
  label: "Subtractive",
  family: "Synths",
  tags: ["bass", "lead", "warm"],
  schema: subtractiveSchema,
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      osc_pitch: {
        block: "pitch",
        voice: true,
        inputs: { frequency: "voice.frequency", semitones: { param: "osc.detune", scale: 0.01 } },
      },
      osc_sine: { block: "sine", voice: true, inputs: { frequency: "osc_pitch" } },
      osc_sawtooth_raw: { block: "saw", voice: true, inputs: { frequency: "osc_pitch" } },
      osc_sawtooth: { block: "mul", voice: true, inputs: { a: "osc_sawtooth_raw", b: 0.849 } },
      osc_square_raw: { block: "pulse", voice: true, inputs: { frequency: "osc_pitch", width: 0.5 } },
      osc_square: { block: "mul", voice: true, inputs: { a: "osc_square_raw", b: 0.849 } },
      osc_triangle: { block: "triangle", voice: true, inputs: { frequency: "osc_pitch" } },
      osc: {
        block: "select",
        voice: true,
        inputs: {
          index: { param: "osc.waveform" },
          a: "osc_sine",
          b: "osc_sawtooth",
          c: "osc_square",
          d: "osc_triangle",
        },
      },
      filter_pitch: {
        block: "pitch",
        voice: true,
        inputs: { frequency: { param: "filter.cutoff" }, semitones: { from: "filterEnvDepth", scale: 0.01 } },
      },
      filter: {
        block: "biquad",
        voice: true,
        inputs: { signal: "osc", type: 0, frequency: "filter_pitch", q: { param: "filter.resonance" }, gain: 0 },
      },
      filterEnv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "fenv.attack", scale: 0.001 },
          decay: { param: "fenv.decay", scale: 0.001 },
          sustain: { param: "fenv.sustain" },
          release: { param: "fenv.release", scale: 0.001 },
        },
      },
      filterEnvDepth: { block: "mul", voice: true, inputs: { a: "filterEnv", b: { param: "filter.env", scale: 100 } } },
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
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level" } } },
    },
    voice: "vca",
    output: "level",
  },
};
