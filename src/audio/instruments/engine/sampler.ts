/**
 * Sampler: plays one sample, pitched by the note from its root (or not, without keytrack), from
 * a start and with a trimmed end.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

// One-shot sampler. `sampler.sample` is the keystone's `sample` kind - a ref into
// the built-in kit (or, later, an imported file); the picker fills the choices.
// Short envelope by default since notes play the whole sample (percussive).
export const samplerSchema: ParamSchema = [
  { id: "sampler.sample", label: "Sample", kind: "sample", default: "builtin:kick" },
  { id: "sampler.root", label: "Root", kind: "number", min: 0, max: 127, default: 60, taper: "linear" },
  { id: "sampler.keytrack", label: "Keytrack", kind: "boolean", default: true },
  // Skips into the sample, for a recording that caught silence or a false start before the sound.
  {
    id: "sampler.start",
    label: "Start",
    kind: "number",
    min: 0,
    max: 2000,
    default: 0,
    unit: "ms",
    taper: "linear",
    step: 1,
  },
  // Cuts that much off the end, for a tail you did not want: room noise, the next hit, a click.
  {
    id: "sampler.trimEnd",
    label: "Trim end",
    kind: "number",
    min: 0,
    max: 5000,
    default: 0,
    unit: "ms",
    taper: "linear",
    step: 1,
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.85, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 1,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 5,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const sampler: EngineBuiltin = {
  type: "sampler",
  label: "Sampler",
  family: "Percussion",
  tags: ["percussion", "keys"],
  schema: samplerSchema,
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      player: {
        block: "sampler",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          gate: "voice.gate",
          sample: "voice.sample",
          root: "voice.root",
          start: "voice.start",
          end: "voice.end",
        },
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
      amp: {
        block: "mul",
        voice: true,
        stereo: true,
        inputs: { a: { left: "player.left", right: "player.right" }, b: "envelope" },
      },
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level" } } },
    },
    voice: "amp",
    output: "level",
    zones: [
      {
        sample: { param: "sampler.sample" },
        root: { param: "sampler.root" },
        keytrack: { param: "sampler.keytrack" },
        trimStart: { param: "sampler.start" },
        trimEnd: { param: "sampler.trimEnd" },
      },
    ],
  },
};
