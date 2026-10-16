/**
 * Bell (INST-42): FM, a sine modulating a sine at an inharmonic ratio. The modulation dies away
 * faster than the note (Shine), so it strikes bright and rings out pure, as a struck bell does.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const bell: EngineBuiltin = {
  type: "bell",
  label: "Bell",
  family: "Keys",
  tags: ["keys", "glassy", "bright"],
  color: "cyan",
  schema: [
    { id: "ratio", label: "Ratio", kind: "number", min: 0.5, max: 8, default: 3.5, step: 0.01 },
    { id: "index", label: "Brightness", kind: "number", min: 0, max: 8, default: 3 },
    { id: "shine", label: "Shine", kind: "number", min: 0.05, max: 4, default: 0.8, unit: "s", taper: "exponential" },
    { id: "decay", label: "Decay", kind: "number", min: 0.2, max: 10, default: 3, unit: "s", taper: "exponential" },
    { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7 },
  ],
  definition: {
    format: 1,
    voices: 12,
    nodes: {
      modEnv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.001,
          decay: { param: "shine" },
          sustain: 0,
          release: { param: "shine" },
        },
      },
      ampEnv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.002,
          decay: { param: "decay" },
          sustain: 0,
          release: { param: "decay", scale: 0.5 },
        },
      },
      modulator: {
        block: "sine",
        voice: true,
        inputs: { frequency: { from: "voice.frequency", scale: { param: "ratio" } } },
      },
      // How far the modulator swings the carrier, in Hz: the note times Brightness, as Shine fades it.
      deviation: {
        block: "mul",
        voice: true,
        inputs: { a: "modEnv", b: { from: "voice.frequency", scale: { param: "index" } } },
      },
      fm: { block: "mul", voice: true, inputs: { a: "modulator", b: "deviation" } },
      carrier: { block: "sine", voice: true, inputs: { frequency: ["voice.frequency", "fm"] } },
      amp: { block: "mul", voice: true, inputs: { a: "carrier", b: { from: "ampEnv", scale: { param: "level" } } } },
    },
    voice: "amp",
  },
};
