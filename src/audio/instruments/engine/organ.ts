/**
 * Organ (INST-17): six sine partials at 1 to 6 times the note, summed, like a drawbar organ.
 * `organ.brightness` rolls the upper partials in: partial h is weighted brightness^(h-1), over the
 * sum of the weights, from a mellow fundamental to a bright, reedy tone. That isn't a straight line
 * in brightness, so each partial's level is a table sampled from the formula: 21 points keep every
 * level within about 1% of it.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";

export const organSchema: ParamSchema = [
  { id: "organ.brightness", label: "Brightness", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear" },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 10,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 120,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const ORGAN_HARMONICS = [1, 2, 3, 4, 5, 6];

/** Partial `harmonic`'s share of the voice at a brightness: its weight over the sum of all. */
export const organPartialLevel = (harmonic: number, brightness: number): number => {
  const weights = ORGAN_HARMONICS.map((each) => Math.pow(brightness, each - 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights[harmonic - 1] / total;
};

/** A partial's level across brightness 0 to 1, as [brightness, level] rows for a param table. */
const levelTable = (harmonic: number) =>
  Array.from({ length: 21 }, (_, index) => [index / 20, organPartialLevel(harmonic, index / 20)]);

export const organ: EngineBuiltin = {
  type: "organ",
  label: "Organ",
  family: "Keys",
  tags: ["keys", "retro", "warm"],
  color: "red",
  schema: organSchema,
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      ...Object.fromEntries(
        ORGAN_HARMONICS.flatMap((harmonic) => [
          [
            `partial${harmonic}`,
            { block: "sine", voice: true, inputs: { frequency: { from: "voice.frequency", scale: harmonic } } },
          ],
          [
            `level${harmonic}`,
            {
              block: "mul",
              voice: true,
              inputs: { a: `partial${harmonic}`, b: { param: "organ.brightness", table: levelTable(harmonic) } },
            },
          ],
        ]),
      ),
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
        inputs: { a: ORGAN_HARMONICS.map((harmonic) => `level${harmonic}`), b: "envelope" },
      },
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level" } } },
    },
    voice: "amp",
    output: "level",
  },
};
