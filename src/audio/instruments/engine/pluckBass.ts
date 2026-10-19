/**
 * Pluck Bass (INST-42): a plucked string (Karplus-Strong: a burst of noise round a delay one period
 * long, damped each time round) with a sine an octave below for weight.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const pluckBass: EngineBuiltin = {
  type: "pluck-bass",
  label: "Pluck Bass",
  family: "Bass",
  tags: ["bass", "pluck", "warm"],
  color: "red",
  schema: [
    { id: "tone", label: "Tone", kind: "number", min: 200, max: 6000, default: 1200, unit: "Hz", taper: "exponential" },
    { id: "decay", label: "Decay", kind: "number", min: 0.2, max: 6, default: 1.5, unit: "s", taper: "exponential" },
    { id: "sub", label: "Sub", kind: "number", min: 0, max: 1, default: 0.5 },
    { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
  ],
  definition: {
    format: 1,
    voices: 6,
    nodes: {
      exciter: { block: "noise", voice: true },
      // Two periods of noise, in seconds (near enough at 44.1 kHz too).
      burst: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.001,
          decay: { from: "period", scale: 2 / 48000 },
          sustain: 0,
          release: 0.001,
        },
      },
      excite: { block: "mul", voice: true, inputs: { a: "exciter", b: "burst" } },
      period: { block: "period", voice: true, inputs: { frequency: "voice.frequency", offset: 0.5 } },
      string: { block: "delay", voice: true, inputs: { signal: ["excite", "feedback"], length: "period" } },
      damping: {
        block: "onepole",
        voice: true,
        inputs: { signal: "string", cutoff: [{ param: "tone" }, { from: "voice.frequency", scale: 3 }] },
      },
      ring: { block: "loopgain", voice: true, inputs: { period: "period", time: { param: "decay" } } },
      feedback: { block: "mul", voice: true, inputs: { a: "damping", b: "ring" } },
      subOsc: { block: "sine", voice: true, inputs: { frequency: { from: "voice.frequency", scale: 0.5 } } },
      subEnv: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.003, decay: { param: "decay", scale: 0.6 }, sustain: 0, release: 0.08 },
      },
      subOut: { block: "mul", voice: true, inputs: { a: "subOsc", b: { from: "subEnv", scale: { param: "sub" } } } },
      // Stops the string when the note is let go, rather than letting it ring out.
      gateEnv: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.001, decay: 0, sustain: 1, release: 0.08 },
      },
      amp: {
        block: "mul",
        voice: true,
        // Trimmed (INST-46): a four-note chord at the old level peaked past full scale.
        inputs: { a: ["string", "subOut"], b: { from: "gateEnv", scale: { param: "level", scale: 0.7 } } },
      },
    },
    voice: "amp",
  },
};
