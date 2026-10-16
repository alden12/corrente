/**
 * Pluck (INST-42, from INST-36.5's test devices): a plucked string (Karplus-Strong), a burst of
 * noise round a delay one period long. Two things keep high notes from going dull and dying at once,
 * since they go round the loop many more times a second: the damping filter's cutoff rises with the note, and the loop's gain is set per note
 * (`loopgain`) so every note rings for about `decay`. The burst lasts two periods, so a high note
 * isn't driven many times round and made loud.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const pluck: EngineBuiltin = {
  type: "pluck",
  label: "Pluck",
  family: "Synths",
  tags: ["pluck", "keys", "bright"],
  color: "lime",
  schema: [
    {
      id: "brightness",
      label: "Brightness",
      kind: "number",
      min: 500,
      max: 12000,
      default: 5000,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "decay", label: "Decay", kind: "number", min: 0.2, max: 10, default: 3, unit: "s", taper: "exponential" },
  ],
  definition: {
    format: 1,
    nodes: {
      exciter: { block: "noise", voice: true },
      burst: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.001,
          // Two periods, in seconds (near enough at 44.1 kHz too).
          decay: { from: "period", scale: 2 / 48000 },
          sustain: 0,
          release: 0.001,
        },
      },
      excite: { block: "mul", voice: true, inputs: { a: "exciter", b: "burst" } },
      period: { block: "period", voice: true, inputs: { frequency: "voice.frequency", offset: 0.5 } },
      string: { block: "delay", voice: true, inputs: { signal: ["excite", "feedback"], length: "period" } },
      // Brightness, plus six times the note: high notes stay bright.
      damping: {
        block: "onepole",
        voice: true,
        inputs: { signal: "string", cutoff: [{ param: "brightness" }, { from: "voice.frequency", scale: 6 }] },
      },
      ring: { block: "loopgain", voice: true, inputs: { period: "period", time: { param: "decay" } } },
      feedback: { block: "mul", voice: true, inputs: { a: "damping", b: "ring" } },
    },
    voice: "string",
  },
};
