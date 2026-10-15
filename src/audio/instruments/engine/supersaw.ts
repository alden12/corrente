/**
 * Supersaw: up to nine saws per note, spread evenly across the detune either side of it, each at
 * one over the count so more saws doesn't mean louder.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const supersawSchema: ParamSchema = [
  { id: "super.voices", label: "Voices", kind: "number", min: 1, max: 9, default: 7, step: 1, taper: "linear" },
  {
    id: "super.detune",
    label: "Detune",
    kind: "number",
    min: 0,
    max: 100,
    default: 25,
    unit: "cents",
    taper: "linear",
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 8,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 300,
    unit: "ms",
    taper: "exponential",
  },
] as const;

/** The most saws a note can have: `super.voices` at its top. */
const SAWS = 9;
const counts = Array.from({ length: SAWS }, (_, index) => index + 1);

/** Each saw's part at each count of saws: [count, value] rows for a param table. */
const perCount = (valueAt: (count: number) => number) => counts.map((count) => [count, valueAt(count)]);

/**
 * Saw `saw` of `count`: one over the count if it plays, and its place in the detune, from -1 (the
 * first) to 1 (the last). One saw plays in tune.
 */
const levelOf = (saw: number) => perCount((count) => (saw <= count ? 1 / count : 0));
const placeOf = (saw: number) =>
  perCount((count) => (saw > count || count === 1 ? 0 : -1 + (2 * (saw - 1)) / (count - 1)));

const sawNodes = Object.fromEntries(
  counts.flatMap((saw) => [
    // Detune is in cents.
    [
      `spread${saw}`,
      {
        block: "mul",
        voice: true,
        inputs: { a: { param: "super.voices", table: placeOf(saw) }, b: { param: "super.detune" } },
      },
    ],
    [
      `pitch${saw}`,
      {
        block: "pitch",
        voice: true,
        inputs: { frequency: "voice.frequency", semitones: { from: `spread${saw}`, scale: 0.01 } },
      },
    ],
    [`saw${saw}`, { block: "saw", voice: true, inputs: { frequency: `pitch${saw}` } }],
    // 0.849: Web Audio's sawtooth level, which this was voiced on.
    [
      `level${saw}`,
      {
        block: "mul",
        voice: true,
        inputs: { a: { from: `saw${saw}`, scale: 0.849 }, b: { param: "super.voices", table: levelOf(saw) } },
      },
    ],
  ]),
);

export const supersaw: EngineBuiltin = {
  type: "supersaw",
  label: "Supersaw",
  family: "Synths",
  tags: ["lead", "pad", "bright", "lush"],
  schema: supersawSchema,
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      ...sawNodes,
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
        inputs: { a: counts.map((saw) => `level${saw}`), b: "envelope" },
      },
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level" } } },
    },
    voice: "amp",
    output: "level",
  },
};
