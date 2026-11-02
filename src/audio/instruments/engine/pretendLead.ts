/**
 * Pretend Lead: a bright, gliding mono lead, after the synth line of MGMT's "Time to Pretend". Built
 * over MCP and promoted (INST-32): a saw, a pulse and a saw an octave up through a ladder low-pass with
 * a short envelope and key tracking, vibrato, then drive, chorus and a little reverb. Legato by
 * default, so a note played over another slides there (Glide) without starting its envelopes again.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const pretendLead: EngineBuiltin = {
  type: "pretend-lead",
  label: "Pretend Lead",
  family: "Synths",
  tags: ["lead", "bright", "retro"],
  color: "amber",
  schema: [
    { id: "o1.level", label: "Saw", kind: "number", min: 0, max: 1, default: 1 },
    { id: "o2.level", label: "Pulse", kind: "number", min: 0, max: 1, default: 0.6 },
    { id: "o2.width", label: "Pulse Width", kind: "number", min: 0.05, max: 0.5, default: 0.3 },
    { id: "o3.level", label: "Octave Saw", kind: "number", min: 0, max: 1, default: 0.4 },
    { id: "osc.detune", label: "Detune", kind: "number", min: 0, max: 30, default: 6, unit: "ct" },
    { id: "glide", label: "Glide", kind: "number", min: 0, max: 500, default: 60, unit: "ms" },
    { id: "legato", label: "Legato", kind: "boolean", default: true },
    {
      id: "f.cutoff",
      label: "Cutoff",
      kind: "number",
      min: 100,
      max: 16000,
      default: 3200,
      unit: "Hz",
      taper: "exponential",
      smoothMs: 20,
    },
    { id: "f.reso", label: "Resonance", kind: "number", min: 0, max: 0.95, default: 0.35 },
    { id: "f.env", label: "Filter Env", kind: "number", min: 0, max: 36, default: 6, unit: "st" },
    {
      id: "f.decay",
      label: "Filter Decay",
      kind: "number",
      min: 10,
      max: 2000,
      default: 300,
      unit: "ms",
      taper: "exponential",
    },
    { id: "f.kbd", label: "Key Track", kind: "number", min: 0, max: 1, default: 0.5 },
    { id: "vib.rate", label: "Vibrato Rate", kind: "number", min: 1, max: 14, default: 7, unit: "Hz" },
    { id: "vib.depth", label: "Vibrato Depth", kind: "number", min: 0, max: 100, default: 25, unit: "ct" },
    {
      id: "amp.attack",
      label: "Attack",
      kind: "number",
      min: 1,
      max: 1000,
      default: 2,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "amp.release",
      label: "Release",
      kind: "number",
      min: 5,
      max: 2000,
      default: 60,
      unit: "ms",
      taper: "exponential",
    },
    { id: "fx.drive", label: "Drive", kind: "number", min: 1, max: 10, default: 1.5 },
    { id: "fx.chorus", label: "Chorus", kind: "number", min: 0, max: 1, default: 0.2 },
    { id: "fx.reverb", label: "Reverb", kind: "number", min: 0, max: 1, default: 0.12 },
    { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
  ],
  definition: {
    format: 1,
    // A mono lead, but a released note's tail can ring under the next.
    voices: 4,
    legato: { param: "legato" },
    nodes: {
      // The note's pitch, sliding from the last one when played legato.
      glide: {
        block: "glide",
        voice: true,
        inputs: { frequency: "voice.frequency", gate: "voice.gate", time: { param: "glide", scale: 0.001 } },
      },
      vib: { block: "lfo", voice: true, inputs: { rate: { param: "vib.rate" } } },
      f1: {
        block: "pitch",
        voice: true,
        inputs: { frequency: "glide", semitones: { from: "vib.triangle", scale: { param: "vib.depth", scale: 0.01 } } },
      },
      f2: { block: "pitch", voice: true, inputs: { frequency: "f1", semitones: { param: "osc.detune", scale: 0.01 } } },
      f3: {
        block: "pitch",
        voice: true,
        inputs: { frequency: "f1", semitones: { param: "osc.detune", scale: -0.01, offset: 12 } },
      },
      o1: { block: "saw", voice: true, inputs: { frequency: "f1" } },
      o2: { block: "pulse", voice: true, inputs: { frequency: "f2", width: { param: "o2.width" } } },
      o3: { block: "saw", voice: true, inputs: { frequency: "f3" } },
      mixr: {
        block: "add",
        voice: true,
        inputs: {
          a: { from: "o1", scale: { param: "o1.level" } },
          b: [
            { from: "o2", scale: { param: "o2.level" } },
            { from: "o3", scale: { param: "o3.level" } },
          ],
        },
      },
      fenv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: 0.002,
          decay: { param: "f.decay", scale: 0.001 },
          sustain: 0,
          release: 0.1,
        },
      },
      // The cutoff: the knob, opened by the envelope, and following the keys from middle C.
      fcut: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: { param: "f.cutoff" },
          semitones: [
            { from: "fenv", scale: { param: "f.env" } },
            { from: "voice.note", scale: { param: "f.kbd" }, offset: { param: "f.kbd", scale: -60 } },
          ],
        },
      },
      lad: {
        block: "ladder",
        voice: true,
        inputs: { signal: { from: "mixr", scale: 0.33 }, cutoff: "fcut", resonance: { param: "f.reso" } },
      },
      aenv: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "amp.attack", scale: 0.001 },
          decay: 0.1,
          sustain: 1,
          release: { param: "amp.release", scale: 0.001 },
        },
      },
      vca: { block: "mul", voice: true, inputs: { a: "lad", b: "aenv" } },
      drv: { block: "shaper", stereo: true, inputs: { signal: "voices", drive: { param: "fx.drive" } } },
      lvl: { block: "mul", stereo: true, inputs: { a: "drv", b: { param: "amp.level" } } },
      ch: {
        block: "chorus",
        inputs: {
          left: "lvl_left",
          right: "lvl_right",
          mix: { param: "fx.chorus" },
          rate: 0.3,
          delay: 10,
          depth: 0.4,
        },
      },
      rv: {
        block: "reverb",
        inputs: {
          left: "ch.left",
          right: "ch.right",
          mix: { param: "fx.reverb" },
          decay: 1.6,
          damping: 7000,
          predelay: 15,
        },
      },
    },
    voice: "vca",
    output: ["rv.left", "rv.right"],
  },
};
