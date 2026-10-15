/**
 * Nimbus (INST-36.8 part 5): a warm, Juno-inspired polyphonic subtractive synth, rebuilt from its
 * hand-written worklet as the test of the blocks. Each voice mixes a saw, a pulse with PWM, a sub an
 * octave down and noise, through a four-pole ladder low-pass swept by the envelope, the note and the
 * LFO. One LFO for the track vibratos the pitch, sweeps the filter and moves the pulse width, faded
 * in over `lfo.delay` from each note's start; the voice seed detunes each note a little (drift).
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const nimbus: EngineBuiltin = {
  type: "nimbus",
  label: "Nimbus",
  family: "Synths",
  tags: ["pad", "bass", "warm", "lush", "retro"],
  schema: [
    { id: "osc.saw", label: "Saw", kind: "number", min: 0, max: 1, default: 0.8, taper: "linear", smoothMs: 15 },
    { id: "osc.pulse", label: "Pulse", kind: "number", min: 0, max: 1, default: 0, taper: "linear", smoothMs: 15 },
    {
      id: "osc.pulseWidth",
      label: "Pulse Width",
      kind: "number",
      min: 0.05,
      max: 0.95,
      default: 0.5,
      taper: "linear",
      smoothMs: 15,
    },
    { id: "osc.sub", label: "Sub", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear", smoothMs: 15 },
    { id: "osc.noise", label: "Noise", kind: "number", min: 0, max: 1, default: 0, taper: "linear", smoothMs: 15 },
    { id: "osc.drift", label: "Drift", kind: "number", min: 0, max: 1, default: 0.2, taper: "linear" },
    {
      id: "filter.cutoff",
      label: "Cutoff",
      kind: "number",
      min: 20,
      max: 18000,
      default: 3000,
      unit: "Hz",
      taper: "exponential",
      smoothMs: 15,
    },
    {
      id: "filter.resonance",
      label: "Resonance",
      kind: "number",
      min: 0,
      max: 1,
      default: 0.2,
      taper: "linear",
      smoothMs: 15,
    },
    {
      id: "filter.env",
      label: "Env Amount",
      kind: "number",
      min: -1,
      max: 1,
      default: 0.4,
      taper: "linear",
      smoothMs: 15,
    },
    { id: "filter.keytrack", label: "Keytrack", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear" },
    {
      id: "env.attack",
      label: "Attack",
      kind: "number",
      min: 1,
      max: 4000,
      default: 6,
      unit: "ms",
      taper: "exponential",
    },
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
    { id: "env.sustain", label: "Sustain", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear" },
    {
      id: "env.release",
      label: "Release",
      kind: "number",
      min: 1,
      max: 6000,
      default: 300,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "lfo.rate",
      label: "LFO Rate",
      kind: "number",
      min: 0.05,
      max: 20,
      default: 5,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "lfo.pitch", label: "LFO Pitch", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
    { id: "lfo.filter", label: "LFO Filter", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
    { id: "lfo.pwm", label: "LFO PWM", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
    { id: "lfo.delay", label: "LFO Delay", kind: "number", min: 0, max: 4000, default: 0, unit: "ms", taper: "linear" },
    { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear", smoothMs: 10 },
  ],
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      lfo: { block: "lfo", inputs: { rate: { param: "lfo.rate" } } },
      // The LFO's depth for this note, rising over the delay. It holds through the release.
      fade: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: { param: "lfo.delay", scale: 0.001 }, sustain: 1, release: 30 },
      },
      wobble: { block: "mul", voice: true, inputs: { a: "lfo.sine", b: "fade" } },
      // Up to 50 cents of vibrato, and up to 6 cents of drift either way, from the voice seed.
      tune: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          semitones: [
            { from: "wobble", scale: { param: "lfo.pitch", scale: 0.5 } },
            {
              from: "voice.seed",
              scale: { param: "osc.drift", scale: 0.12 },
              offset: { param: "osc.drift", scale: -0.06 },
            },
          ],
        },
      },
      saw: { block: "saw", voice: true, inputs: { frequency: "tune" } },
      pulse: {
        block: "pulse",
        voice: true,
        inputs: {
          frequency: "tune",
          width: [{ param: "osc.pulseWidth" }, { from: "wobble", scale: { param: "lfo.pwm", scale: 0.4 } }],
        },
      },
      sub: { block: "pulse", voice: true, inputs: { frequency: { from: "tune", scale: 0.5 }, width: 0.5 } },
      noise: { block: "noise", voice: true },
      envelope: {
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
      // The envelope opens it up to four octaves either way, the note from middle C by the keytrack,
      // and the LFO two octaves.
      cutoff: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: { param: "filter.cutoff" },
          semitones: [
            { from: "envelope", scale: { param: "filter.env", scale: 48 } },
            {
              from: "voice.note",
              scale: { param: "filter.keytrack" },
              offset: { param: "filter.keytrack", scale: -60 },
            },
            { from: "wobble", scale: { param: "lfo.filter", scale: 24 } },
          ],
        },
      },
      filter: {
        block: "ladder",
        voice: true,
        inputs: {
          signal: [
            { from: "saw", scale: { param: "osc.saw" } },
            { from: "pulse", scale: { param: "osc.pulse", scale: -1 } },
            { from: "sub", scale: { param: "osc.sub", scale: -1 } },
            { from: "noise", scale: { param: "osc.noise" } },
          ],
          cutoff: "cutoff",
          resonance: { param: "filter.resonance" },
        },
      },
      amp: { block: "mul", voice: true, inputs: { a: "filter", b: "envelope" } },
      // Headroom for many voices summed, as the worklet had.
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level", scale: 0.3 } } },
    },
    voice: "amp",
    output: "level",
  },
};
