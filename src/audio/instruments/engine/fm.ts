/**
 * FM: a sine carrier whose frequency a sine modulator moves (frequency modulation), the modulator at
 * `fm.ratio` times the note and `fm.index` deep: bells, electric pianos, basses.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const fmSchema: ParamSchema = [
  { id: "fm.ratio", label: "Ratio", kind: "number", min: 0.5, max: 12, default: 2, taper: "linear" },
  { id: "fm.index", label: "Index", kind: "number", min: 0, max: 4000, default: 300, unit: "Hz", taper: "linear" },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 4,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 250,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const fm: EngineBuiltin = {
  type: "fm",
  label: "FM",
  family: "Bass",
  tags: ["bass", "keys", "bright", "glassy"],
  schema: fmSchema,
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      carrier: { block: "sine", voice: true, inputs: { frequency: ["voice.frequency", "modGain"] } },
      mod: {
        block: "sine",
        voice: true,
        inputs: { frequency: { from: "voice.frequency", scale: { param: "fm.ratio" } } },
      },
      modGain: { block: "mul", voice: true, inputs: { a: "mod", b: { param: "fm.index" } } },
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
      amp: { block: "mul", voice: true, inputs: { a: "carrier", b: "envelope" } },
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level" } } },
    },
    voice: "amp",
    output: "level",
  },
};
