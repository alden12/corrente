/**
 * Mellotron Flute: a warm, breathy tape flute (the Strawberry Fields sound). Two triangles spread
 * apart for the tape's chorus, a unison sine for body, a vibrato on each note and a mellow low-pass.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const mellotronFluteSchema: ParamSchema = [
  {
    id: "tone.warmth",
    label: "Warmth",
    kind: "number",
    min: 300,
    max: 8000,
    default: 2400,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "tone.spread", label: "Chorus", kind: "number", min: 0, max: 30, default: 10, unit: "cents", smoothMs: 25 },
  { id: "body.level", label: "Body", kind: "number", min: 0, max: 1, default: 0.35, taper: "linear", smoothMs: 20 },
  {
    id: "vibrato.rate",
    label: "Vibrato Rate",
    kind: "number",
    min: 0.1,
    max: 8,
    default: 4.8,
    unit: "Hz",
    smoothMs: 30,
  },
  {
    id: "vibrato.depth",
    label: "Vibrato Depth",
    kind: "number",
    min: 0,
    max: 40,
    default: 7,
    unit: "cents",
    smoothMs: 30,
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.85, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 95,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 480,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const mellotronFlute: EngineBuiltin = {
  type: "mellotron",
  label: "Mellotron Flute",
  family: "Keys",
  tags: ["keys", "retro", "airy"],
  color: "lime",
  schema: mellotronFluteSchema,
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      osc1_pitch: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          semitones: [
            { param: "tone.spread", scale: -0.005 },
            { from: "lfoDepth", scale: 0.01 },
          ],
        },
      },
      osc1: { block: "triangle", voice: true, inputs: { frequency: "osc1_pitch" } },
      osc2_pitch: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          semitones: [
            { param: "tone.spread", scale: 0.005 },
            { from: "lfoDepth", scale: 0.01 },
          ],
        },
      },
      osc2: { block: "triangle", voice: true, inputs: { frequency: "osc2_pitch" } },
      body_pitch: {
        block: "pitch",
        voice: true,
        inputs: { frequency: "voice.frequency", semitones: { from: "lfoDepth", scale: 0.01 } },
      },
      body: { block: "sine", voice: true, inputs: { frequency: "body_pitch" } },
      g1: { block: "mul", voice: true, inputs: { a: "osc1", b: 0.4 } },
      g2: { block: "mul", voice: true, inputs: { a: "osc2", b: 0.4 } },
      gBody: { block: "mul", voice: true, inputs: { a: "body", b: { param: "body.level" } } },
      lfo: { block: "sine", voice: true, inputs: { frequency: { param: "vibrato.rate" } } },
      lfoDepth: { block: "mul", voice: true, inputs: { a: "lfo", b: { param: "vibrato.depth" } } },
      warmth: {
        block: "biquad",
        voice: true,
        inputs: { signal: ["g1", "g2", "gBody"], type: 0, frequency: { param: "tone.warmth" }, q: 0.7, gain: 0 },
      },
      envelope: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "env.attack", scale: 0.001 },
          decay: 0,
          sustain: 1,
          release: { param: "env.release", scale: 0.001 },
        },
      },
      amp: { block: "mul", voice: true, inputs: { a: "warmth", b: "envelope" } },
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level" } } },
    },
    voice: "amp",
    output: "level",
  },
};
