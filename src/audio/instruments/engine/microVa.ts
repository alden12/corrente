/**
 * Micro VA: a two-oscillator virtual-analog synth in the manner of the small VA keyboards of the early
 * 2000s, written by Claude over the hosted MCP (2026-10-18) and adopted as a built-in.
 *
 * Oscillator 1 picks saw, pulse (its width on Ctrl, swept by LFO 1), triangle, sine or a wavetable
 * (Ctrl and LFO 1 move its position); oscillator 2 is detuned below it and can ring-modulate it. A
 * ladder or state-variable filter, opened by its own envelope, key tracking and velocity; LFO 2 free or
 * synced to the beat, on pitch and cutoff. Then drive, chorus and a synced delay on the whole output.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const microVa: EngineBuiltin = {
  type: "micro-va",
  label: "Micro VA",
  family: "Synths",
  tags: ["pad", "lead", "warm", "retro"],
  color: "orange",
  schema: [
    {
      id: "o1.wave",
      label: "Osc1 Wave",
      kind: "enum",
      options: ["Saw", "Pulse", "Triangle", "Sine", "Digital"],
      default: "Pulse",
    },
    { id: "o1.ctrl1", label: "Osc1 Ctrl", kind: "number", min: 0, max: 1, default: 0.3 },
    { id: "o1.table", label: "Digital Wave", kind: "sample", default: "wavetable:classic", wavetable: true },
    { id: "o2.wave", label: "Osc2 Wave", kind: "enum", options: ["Saw", "Square", "Triangle"], default: "Saw" },
    { id: "o2.mod", label: "Osc2 Mod", kind: "enum", options: ["Off", "Ring"], default: "Off" },
    { id: "o2.semi", label: "Osc2 Semi", kind: "number", min: -24, max: 24, step: 1, default: 0, unit: "st" },
    { id: "o2.tune", label: "Osc2 Tune", kind: "number", min: -50, max: 50, default: -8, unit: "ct" },
    { id: "o1.level", label: "Osc1 Level", kind: "number", min: 0, max: 1, default: 1 },
    { id: "o2.level", label: "Osc2 Level", kind: "number", min: 0, max: 1, default: 0.6 },
    { id: "noise.level", label: "Noise Level", kind: "number", min: 0, max: 1, default: 0 },
    {
      id: "f.type",
      label: "Filter Type",
      kind: "enum",
      options: ["24dB LPF", "12dB LPF", "12dB BPF", "12dB HPF"],
      default: "12dB LPF",
    },
    {
      id: "f.cutoff",
      label: "Cutoff",
      kind: "number",
      min: 20,
      max: 20000,
      default: 1800,
      unit: "Hz",
      taper: "exponential",
      smoothMs: 20,
    },
    { id: "f.reso", label: "Resonance", kind: "number", min: 0, max: 1, default: 0.1 },
    { id: "f.egInt", label: "Filter EG Int", kind: "number", min: -48, max: 48, default: 18, unit: "st" },
    { id: "f.kbd", label: "Key Track", kind: "number", min: 0, max: 1, default: 0.5 },
    { id: "f.vel", label: "Velocity > Cutoff", kind: "number", min: 0, max: 24, default: 6, unit: "st" },
    {
      id: "eg1.a",
      label: "Filter Attack",
      kind: "number",
      min: 1,
      max: 5000,
      default: 1500,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "eg1.d",
      label: "Filter Decay",
      kind: "number",
      min: 1,
      max: 5000,
      default: 2000,
      unit: "ms",
      taper: "exponential",
    },
    { id: "eg1.s", label: "Filter Sustain", kind: "number", min: 0, max: 1, default: 0.6 },
    {
      id: "eg1.r",
      label: "Filter Release",
      kind: "number",
      min: 1,
      max: 5000,
      default: 2000,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "eg2.a",
      label: "Amp Attack",
      kind: "number",
      min: 1,
      max: 5000,
      default: 900,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "eg2.d",
      label: "Amp Decay",
      kind: "number",
      min: 1,
      max: 5000,
      default: 1000,
      unit: "ms",
      taper: "exponential",
    },
    { id: "eg2.s", label: "Amp Sustain", kind: "number", min: 0, max: 1, default: 0.9 },
    {
      id: "eg2.r",
      label: "Amp Release",
      kind: "number",
      min: 1,
      max: 5000,
      default: 1800,
      unit: "ms",
      taper: "exponential",
    },
    {
      id: "lfo1.rate",
      label: "LFO1 Rate",
      kind: "number",
      min: 0.05,
      max: 20,
      default: 0.4,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "lfo1.pwm", label: "LFO1 > Pulse/Pos", kind: "number", min: 0, max: 0.45, default: 0.3 },
    { id: "lfo2.sync", label: "LFO2 Sync", kind: "boolean", default: false },
    {
      id: "lfo2.rate",
      label: "LFO2 Rate",
      kind: "number",
      min: 0.05,
      max: 20,
      default: 5.5,
      unit: "Hz",
      taper: "exponential",
    },
    {
      id: "lfo2.div",
      label: "LFO2 Division",
      kind: "enum",
      options: ["4/1", "2/1", "1/1", "1/2", "1/4", "1/8", "1/16"],
      default: "1/4",
    },
    { id: "lfo2.pitch", label: "LFO2 > Pitch", kind: "number", min: 0, max: 100, default: 0, unit: "ct" },
    { id: "lfo2.cutoff", label: "LFO2 > Cutoff", kind: "number", min: -24, max: 24, default: 0, unit: "st" },
    { id: "amp.dist", label: "Distortion", kind: "boolean", default: false },
    { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.25 },
    {
      id: "mod.rate",
      label: "Chorus Rate",
      kind: "number",
      min: 0.05,
      max: 5,
      default: 0.6,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "mod.depth", label: "Chorus Depth", kind: "number", min: 0, max: 1, default: 0.5 },
    { id: "mod.mix", label: "Chorus Mix", kind: "number", min: 0, max: 1, default: 0.5 },
    {
      id: "dly.div",
      label: "Delay Time",
      kind: "enum",
      options: ["1/16", "1/8", "1/8.", "1/4", "1/4T", "1/4.", "1/2"],
      default: "1/4",
    },
    { id: "dly.fb", label: "Delay Feedback", kind: "number", min: 0, max: 0.9, default: 0.45 },
    { id: "dly.mix", label: "Delay Level", kind: "number", min: 0, max: 1, default: 0.25 },
  ],
  definition: {
    format: 1,
    // 16, not the hardware's 4 (2026-10-31, Alden): with 4, a held chord lost notes to the next ones
    // and to the tails still fading. LFO 1 is shared to make room (16 is 23.9% of a phone's thread).
    voices: 16,
    voice: "vca",
    output: "out",
    nodes: {
      // LFO 2 is shared by every voice: free-running, or locked to the beat.
      lfo2free: { block: "lfo", inputs: { rate: { param: "lfo2.rate" } } },
      lfo2beat: {
        block: "beatlfo",
        inputs: { beat: "host.beat", length: { beats: { param: "lfo2.div" }, as: "beats" } },
      },
      lfo2sel: {
        block: "select",
        inputs: { index: { param: "lfo2.sync" }, a: "lfo2free.sine", b: "lfo2beat.sine", c: 0, d: 0 },
      },

      f1: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          semitones: { from: "lfo2sel", scale: { param: "lfo2.pitch", scale: 0.01 } },
        },
      },
      o2f: {
        block: "pitch",
        voice: true,
        inputs: { frequency: "f1", semitones: [{ param: "o2.semi" }, { param: "o2.tune", scale: 0.01 }] },
      },
      // Shared by every voice, as LFO 2 is: it reads nothing of the note, only its rate, and sharing it
      // is what lets 16 voices fit a phone. Voices sweep their pulse width and wavetable in step.
      lfo1: { block: "lfo", inputs: { rate: { param: "lfo1.rate" } } },
      pw: {
        block: "add",
        voice: true,
        inputs: {
          a: { param: "o1.ctrl1", scale: 0.45, offset: 0.5 },
          b: { from: "lfo1.triangle", scale: { param: "lfo1.pwm" } },
        },
      },
      wtpos: {
        block: "add",
        voice: true,
        inputs: { a: { param: "o1.ctrl1" }, b: { from: "lfo1.triangle", scale: { param: "lfo1.pwm" } } },
      },

      // Five waves from two selects, since a select takes four (INST-45): the first picks among the
      // analog four, the second between those and the wavetable.
      o1saw: { block: "saw", voice: true, inputs: { frequency: "f1" } },
      o1pulse: { block: "pulse", voice: true, inputs: { frequency: "f1", width: "pw" } },
      o1tri: { block: "triangle", voice: true, inputs: { frequency: "f1" } },
      o1sine: { block: "sine", voice: true, inputs: { frequency: "f1" } },
      o1wt: {
        block: "wavetable",
        voice: true,
        inputs: { frequency: "f1", position: "wtpos", table: { param: "o1.table" } },
      },
      o1a: {
        block: "select",
        voice: true,
        inputs: {
          index: {
            param: "o1.wave",
            table: [
              [0, 0],
              [1, 1],
              [2, 2],
              [3, 3],
              [4, 3],
            ],
          },
          a: "o1saw",
          b: "o1pulse",
          c: "o1tri",
          d: "o1sine",
        },
      },
      o1: {
        block: "select",
        voice: true,
        inputs: {
          index: {
            param: "o1.wave",
            table: [
              [0, 0],
              [3, 0],
              [4, 1],
            ],
          },
          a: "o1a",
          b: "o1wt",
          c: 0,
          d: 0,
        },
      },

      o2saw: { block: "saw", voice: true, inputs: { frequency: "o2f" } },
      o2sq: { block: "pulse", voice: true, inputs: { frequency: "o2f", width: 0.5 } },
      o2tri: { block: "triangle", voice: true, inputs: { frequency: "o2f" } },
      o2w: {
        block: "select",
        voice: true,
        inputs: { index: { param: "o2.wave" }, a: "o2saw", b: "o2sq", c: "o2tri", d: 0 },
      },
      ring: { block: "mul", voice: true, inputs: { a: "o1", b: "o2w" } },
      o2: { block: "select", voice: true, inputs: { index: { param: "o2.mod" }, a: "o2w", b: "ring", c: 0, d: 0 } },

      nz: { block: "noise", voice: true },
      mixr: {
        block: "add",
        voice: true,
        inputs: {
          a: { from: "o1", scale: { param: "o1.level" } },
          b: [
            { from: "o2", scale: { param: "o2.level" } },
            { from: "nz", scale: { param: "noise.level" } },
          ],
        },
      },

      eg1: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "eg1.a", scale: 0.001 },
          decay: { param: "eg1.d", scale: 0.001 },
          sustain: { param: "eg1.s" },
          release: { param: "eg1.r", scale: 0.001 },
        },
      },
      eg2: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "eg2.a", scale: 0.001 },
          decay: { param: "eg2.d", scale: 0.001 },
          sustain: { param: "eg2.s" },
          release: { param: "eg2.r", scale: 0.001 },
        },
      },

      // The cutoff in semitones from the knob: the filter envelope, key tracking around middle C,
      // velocity and LFO 2.
      fcut: {
        block: "pitch",
        voice: true,
        inputs: {
          frequency: { param: "f.cutoff" },
          semitones: [
            { from: "eg1", scale: { param: "f.egInt" } },
            { from: "voice.note", scale: { param: "f.kbd" }, offset: { param: "f.kbd", scale: -60 } },
            { from: "voice.velocity", scale: { param: "f.vel" } },
            { from: "lfo2sel", scale: { param: "lfo2.cutoff" } },
          ],
        },
      },
      lad: {
        block: "ladder",
        voice: true,
        inputs: { signal: { from: "mixr", scale: 0.5 }, cutoff: "fcut", resonance: { param: "f.reso" } },
      },
      sv: {
        block: "svf",
        voice: true,
        inputs: {
          signal: { from: "mixr", scale: 0.5 },
          cutoff: "fcut",
          q: {
            param: "f.reso",
            table: [
              [0, 0.6],
              [1, 18],
            ],
          },
        },
      },
      filt: {
        block: "select",
        voice: true,
        inputs: { index: { param: "f.type" }, a: "lad", b: "sv.lowpass", c: "sv.bandpass", d: "sv.highpass" },
      },
      vca: { block: "mul", voice: true, inputs: { a: "filt", b: "eg2" } },

      // After the voices: drive, level, chorus, and a delay feeding back through `fb`.
      amp: {
        block: "shaper",
        stereo: true,
        inputs: {
          signal: "voices",
          drive: {
            param: "amp.dist",
            table: [
              [0, 1],
              [1, 12],
            ],
          },
        },
      },
      lvl: { block: "mul", stereo: true, inputs: { a: "amp", b: { param: "amp.level" } } },
      ch: {
        block: "chorus",
        inputs: {
          left: "lvl_left",
          right: "lvl_right",
          rate: { param: "mod.rate" },
          depth: { param: "mod.depth" },
          delay: 12,
          mix: { param: "mod.mix" },
        },
      },
      dl: {
        block: "delay",
        stereo: true,
        inputs: {
          signal: { left: ["ch.left", "fb_left"], right: ["ch.right", "fb_right"] },
          length: { beats: { param: "dly.div" }, as: "samples" },
          size: 192000,
        },
      },
      fb: { block: "mul", stereo: true, inputs: { a: "dl", b: { param: "dly.fb" } } },
      out: {
        block: "add",
        stereo: true,
        inputs: { a: { left: "ch.left", right: "ch.right" }, b: { from: "dl", scale: { param: "dly.mix" } } },
      },
    },
  },
};
