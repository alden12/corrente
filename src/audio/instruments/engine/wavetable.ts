/**
 * Wavetable (INST-36.8 part 5): a polyphonic morphing-wavetable synth, rebuilt from its hand-written
 * worklet. Each voice reads round a table of cycles, morphing dark to bright by `wt.position`, with
 * a linear attack and release; the voices summed go through a gentle low-pass (`wt.tone`). The
 * table is a sample param, the classic bank by default (sine, triangle, square, saw), which is what
 * the worklet played.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const wavetable: EngineBuiltin = {
  type: "wavetable",
  label: "Wavetable",
  family: "Synths",
  tags: ["pad", "lead", "glassy"],
  color: "indigo",
  schema: [
    { id: "wt.position", label: "Position", kind: "number", min: 0, max: 1, default: 0, taper: "linear", smoothMs: 20 },
    { id: "wt.tone", label: "Tone", kind: "number", min: 0, max: 1, default: 0.6, taper: "linear", smoothMs: 20 },
    { id: "wt.table", label: "Table", kind: "sample", default: "wavetable:classic", wavetable: true },
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
  ],
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      osc: {
        block: "wavetable",
        voice: true,
        inputs: { frequency: "voice.frequency", position: { param: "wt.position" }, table: { param: "wt.table" } },
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
      amp: { block: "mul", voice: true, inputs: { a: "osc", b: "envelope" } },
      // The worklet's tone was a one-pole coefficient, its square: the same filter, as a cutoff.
      tone: {
        block: "onepole",
        stereo: true,
        inputs: {
          signal: "voices",
          cutoff: {
            param: "wt.tone",
            table: [
              [0, 20],
              [0.05, 20],
              [0.1, 77],
              [0.15, 174],
              [0.2, 312],
              [0.3, 720],
              [0.4, 1332],
              [0.5, 2198],
              [0.6, 3409],
              [0.7, 5144],
              [0.8, 7805],
              [0.9, 12687],
              [0.95, 17784],
              [1, 20000],
            ],
          },
        },
      },
      // Halved (INST-46): a four-note chord at the old level peaked past twice full scale.
      level: { block: "mul", stereo: true, inputs: { a: "tone", b: { param: "amp.level", scale: 0.5 } } },
    },
    voice: "amp",
    output: "level",
  },
};
