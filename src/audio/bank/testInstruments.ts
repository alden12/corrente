/**
 * Instruments and effects to try the new engine with in development (INST-36.5, INST-36.7), before
 * any device moves over (INST-36.8). Registered by devTools.ts, so they never ship: no project on the real deployment may
 * hold a new-engine device until the old format converts and retires (decided 2026-10-14). They go
 * when the built-ins convert.
 */
import { compileDefinition } from "../definitions/compile";
import type { DeviceDefinition } from "../definitions/format";
import { registerInstrument } from "../instruments/catalog";
import { registerInstrumentFactory } from "../instruments/registry";
import type { ParamSchema, ParamSpec } from "../params/types";
import { BUILTIN_SAMPLES, builtinRef, wavetableRef } from "../samples/catalog";
import { registerEffect } from "../effects/catalog";
import { registerEffectFactory } from "../effects/registry";
import { registerEngineDevice } from "../definitions/engineDevices";
import { runEffects } from "./chainPlan";
import { storeParams } from "./EngineDevice";
import { EngineInstrument } from "./EngineInstrument";

interface TestInstrument {
  type: string;
  label: string;
  /** Where the library shelves it: Synths unless it says. */
  family?: string;
  schema: ParamSchema;
  definition: DeviceDefinition;
}

/**
 * A plucked string (Karplus-Strong): a burst of noise round a delay one period long. Two things keep
 * high notes from going dull and dying at once, since they go round the loop many more times a
 * second: the damping filter's cutoff rises with the note, and the loop's gain is set per note
 * (`loopgain`) so every note rings for about `decay`. The burst lasts two periods, so a high note
 * isn't driven many times round and made loud.
 */
const pluck: TestInstrument = {
  type: "engine-pluck",
  label: "Pluck (new engine)",
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

/**
 * A saw, square or sine (a choice, through `select`) through a filter every voice shares one LFO on,
 * free in Hz or (Sync on) locked to the beat, a cycle per note division, into a reverb on the voices
 * summed.
 */
const wobble: TestInstrument = {
  type: "engine-wobble",
  label: "Wobble (new engine)",
  schema: [
    { id: "wave", label: "Wave", kind: "enum", options: ["Saw", "Square", "Sine"], default: "Saw" },
    {
      id: "cutoff",
      label: "Cutoff",
      kind: "number",
      min: 40,
      max: 8000,
      default: 900,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "resonance", label: "Resonance", kind: "number", min: 0.5, max: 12, default: 3, taper: "linear" },
    { id: "wobble", label: "Wobble", kind: "number", min: 0, max: 36, default: 18, unit: "st", taper: "linear" },
    { id: "sync", label: "Sync", kind: "boolean", default: true },
    { id: "hz", label: "Rate", kind: "number", min: 0.1, max: 12, default: 2, unit: "Hz", taper: "exponential" },
    {
      id: "division",
      label: "Division",
      kind: "enum",
      options: ["1/1", "1/2", "1/2.", "1/4", "1/4.", "1/4T", "1/8", "1/8.", "1/8T", "1/16"],
      default: "1/4",
    },
    { id: "attack", label: "Attack", kind: "number", min: 1, max: 2000, default: 5, unit: "ms", taper: "exponential" },
    {
      id: "release",
      label: "Release",
      kind: "number",
      min: 5,
      max: 4000,
      default: 300,
      unit: "ms",
      taper: "exponential",
    },
    { id: "reverb", label: "Reverb", kind: "number", min: 0, max: 1, default: 0.25, taper: "linear" },
  ],
  definition: {
    format: 1,
    nodes: {
      // Free in Hz, or with Sync on, locked to the beat: one cycle per note division, in the same
      // place every time play starts.
      free: { block: "lfo", inputs: { rate: { param: "hz" } } },
      locked: {
        block: "beatlfo",
        inputs: { beat: "host.beat", length: { beats: { param: "division" }, as: "beats" } },
      },
      lfo: {
        block: "select",
        inputs: { index: { param: "sync" }, a: "free.sine", b: "locked.sine", c: 0, d: 0 },
      },
      saw: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      // A pulse at half width is a square, between -1 and 1.
      square: { block: "pulse", voice: true, inputs: { frequency: "voice.frequency", width: 0.5 } },
      sine: { block: "sine", voice: true, inputs: { frequency: "voice.frequency" } },
      osc: {
        block: "select",
        voice: true,
        inputs: { index: { param: "wave" }, a: "saw", b: "square", c: "sine", d: 0 },
      },
      envelope: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "attack", scale: 0.001 },
          release: { param: "release", scale: 0.001 },
          sustain: 0.8,
        },
      },
      cutoff: {
        block: "pitch",
        voice: true,
        inputs: { frequency: { param: "cutoff" }, semitones: { from: "lfo", scale: { param: "wobble" } } },
      },
      filter: { block: "svf", voice: true, inputs: { signal: "osc", cutoff: "cutoff", q: { param: "resonance" } } },
      amp: { block: "mul", voice: true, inputs: { a: "filter.lowpass", b: "envelope" } },
      // Resonance lifts the filter's peak well past 1: down to leave room for chords.
      level: { block: "mul", voice: true, inputs: { a: "amp", b: 0.35 } },
      verb: { block: "reverb", inputs: { left: "voices.left", right: "voices.right", mix: { param: "reverb" } } },
    },
    voice: "level",
    output: ["verb.left", "verb.right"],
  },
};

/**
 * A sample played up and down the keyboard (INST-36.6): any built-in or imported sample, pitched
 * against its root note, trimmed, looped if wanted, through an attack and release.
 */
const sampler: TestInstrument = {
  type: "engine-sampler",
  label: "Sampler (new engine)",
  schema: [
    { id: "sound", label: "Sample", kind: "sample", default: "builtin:tom" },
    { id: "root", label: "Root", kind: "number", min: 0, max: 127, default: 45, step: 1, format: "note" },
    { id: "start", label: "Start", kind: "number", min: 0, max: 1, default: 0 },
    { id: "end", label: "End", kind: "number", min: 0, max: 1, default: 1 },
    { id: "loop", label: "Loop", kind: "boolean", default: false },
    { id: "attack", label: "Attack", kind: "number", min: 0, max: 2000, default: 2, unit: "ms", taper: "exponential" },
    {
      id: "release",
      label: "Release",
      kind: "number",
      min: 5,
      max: 5000,
      default: 300,
      unit: "ms",
      taper: "exponential",
    },
  ],
  definition: {
    format: 1,
    nodes: {
      player: {
        block: "sampler",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          gate: "voice.gate",
          sample: { param: "sound" },
          root: { param: "root" },
          start: { param: "start" },
          end: { param: "end" },
          loop: { param: "loop" },
        },
      },
      envelope: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "attack", scale: 0.001 },
          sustain: 1,
          release: { param: "release", scale: 0.001 },
        },
      },
      left: { block: "mul", voice: true, inputs: { a: "player.left", b: "envelope" } },
      right: { block: "mul", voice: true, inputs: { a: "player.right", b: "envelope" } },
    },
    voice: ["left", "right"],
  },
};

/** The built-in kit's pads, each on its General MIDI drum note. */
const PADS = BUILTIN_SAMPLES.filter((sample) => sample.gmNote !== undefined);

/**
 * A drum kit as sample zones (INST-36.6): a zone per pad on its General MIDI note, each a sample param
 * you can swap, played at its own pitch through one sampler. Soft hits (below a quarter velocity)
 * play the snare's first half only, to show velocity zones. No envelope: each hit plays out.
 */
const drums: TestInstrument = {
  type: "engine-drums",
  label: "Drums (new engine)",
  family: "Percussion",
  schema: [
    ...PADS.map((pad): ParamSpec => ({ id: pad.id, label: pad.name, kind: "sample", default: builtinRef(pad.id) })),
    { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
  ],
  definition: {
    format: 1,
    voices: 16,
    zones: PADS.flatMap((pad) => {
      const key = pad.gmNote!;
      const zone = { sample: { param: pad.id }, root: key, keys: [key, key] as [number, number] };
      return pad.id === "snare"
        ? [
            { ...zone, velocities: [0, 0.25] as [number, number], end: 0.5 },
            { ...zone, velocities: [0.25, 1] as [number, number] },
          ]
        : [zone];
    }),
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
      left: { block: "mul", voice: true, inputs: { a: "player.left", b: { param: "level" } } },
      right: { block: "mul", voice: true, inputs: { a: "player.right", b: { param: "level" } } },
    },
    voice: ["left", "right"],
  },
};

/**
 * A wavetable through an envelope (INST-36.6): a built-in table or any sample cut into cycles, its
 * position set by a knob and swept by an LFO every voice shares.
 */
const wavetable: TestInstrument = {
  type: "engine-wavetable",
  label: "Wavetable (new engine)",
  schema: [
    { id: "table", label: "Table", kind: "sample", default: wavetableRef("classic"), wavetable: true },
    { id: "position", label: "Position", kind: "number", min: 0, max: 1, default: 0.3 },
    { id: "sweep", label: "Sweep", kind: "number", min: 0, max: 0.5, default: 0.2 },
    {
      id: "rate",
      label: "Sweep rate",
      kind: "number",
      min: 0.05,
      max: 10,
      default: 0.5,
      unit: "Hz",
      taper: "exponential",
    },
    { id: "attack", label: "Attack", kind: "number", min: 0, max: 2000, default: 5, unit: "ms", taper: "exponential" },
    {
      id: "release",
      label: "Release",
      kind: "number",
      min: 5,
      max: 5000,
      default: 400,
      unit: "ms",
      taper: "exponential",
    },
  ],
  definition: {
    format: 1,
    nodes: {
      sweep: { block: "lfo", inputs: { rate: { param: "rate" } } },
      osc: {
        block: "wavetable",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          position: [{ param: "position" }, { from: "sweep.sine", scale: { param: "sweep" } }],
          table: { param: "table" },
        },
      },
      envelope: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "attack", scale: 0.001 },
          sustain: 1,
          release: { param: "release", scale: 0.001 },
        },
      },
      amp: { block: "mul", voice: true, inputs: { a: "osc", b: "envelope" } },
      level: { block: "mul", voice: true, inputs: { a: "amp", b: 0.3 } },
    },
    voice: "level",
  },
};

export const TEST_INSTRUMENTS = [pluck, wobble, sampler, drums, wavetable];

/** The uniform wet/dry an effect's schema carries, crossfaded around it (BaseEffect). */
const MIX: ParamSpec = { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.35, smoothMs: 20 };

/** Note divisions an echo can be timed to, in time with the tempo. */
const DIVISIONS = ["1/16", "1/8T", "1/8", "1/8.", "1/4", "1/4.", "1/2"];

/**
 * An echo (INST-36.7): a delay each side, timed to the tempo, each feeding the other through a
 * damping filter, so repeats bounce left and right and darken as they fade. The feedback loop runs
 * through the delays, in chunks; the delays are sized for 4 seconds.
 */
const echo: TestInstrument = {
  type: "engine-echo",
  label: "Echo (new engine)",
  schema: [
    { id: "time", label: "Time", kind: "enum", options: DIVISIONS, default: "1/8." },
    { id: "feedback", label: "Feedback", kind: "number", min: 0, max: 0.95, default: 0.5 },
    {
      id: "tone",
      label: "Tone",
      kind: "number",
      min: 200,
      max: 16000,
      default: 3500,
      unit: "Hz",
      taper: "exponential",
    },
    MIX,
  ],
  definition: {
    format: 1,
    nodes: {
      left: {
        block: "delay",
        inputs: {
          signal: ["input.left", "fromRight"],
          length: { beats: { param: "time" }, as: "samples" },
          size: 4 * 48000,
        },
      },
      right: {
        block: "delay",
        inputs: {
          signal: ["input.right", "fromLeft"],
          length: { beats: { param: "time" }, as: "samples" },
          size: 4 * 48000,
        },
      },
      darkLeft: { block: "onepole", inputs: { signal: "left", cutoff: { param: "tone" } } },
      darkRight: { block: "onepole", inputs: { signal: "right", cutoff: { param: "tone" } } },
      fromLeft: { block: "mul", inputs: { a: "darkLeft", b: { param: "feedback" } } },
      fromRight: { block: "mul", inputs: { a: "darkRight", b: { param: "feedback" } } },
    },
    output: ["left", "right"],
  },
};

/**
 * A resonator (INST-36.7): each side a comb filter, a delay one period of `pitch` long fed back
 * through a damping filter, ringing at that pitch and its harmonics for about `decay` (`loopgain`).
 */
const resonator: TestInstrument = {
  type: "engine-resonator",
  label: "Resonator (new engine)",
  schema: [
    { id: "pitch", label: "Pitch", kind: "number", min: 40, max: 2000, default: 220, unit: "Hz", taper: "exponential" },
    { id: "decay", label: "Decay", kind: "number", min: 0.05, max: 10, default: 1.5, unit: "s", taper: "exponential" },
    {
      id: "tone",
      label: "Tone",
      kind: "number",
      min: 500,
      max: 16000,
      default: 6000,
      unit: "Hz",
      taper: "exponential",
    },
    MIX,
  ],
  definition: {
    format: 1,
    nodes: {
      period: { block: "period", inputs: { frequency: { param: "pitch" }, offset: 0.5 } },
      ring: { block: "loopgain", inputs: { period: "period", time: { param: "decay" } } },
      left: { block: "delay", inputs: { signal: [{ from: "input.left", scale: 0.2 }, "backLeft"], length: "period" } },
      right: {
        block: "delay",
        inputs: { signal: [{ from: "input.right", scale: 0.2 }, "backRight"], length: "period" },
      },
      dampLeft: { block: "onepole", inputs: { signal: "left", cutoff: { param: "tone" } } },
      dampRight: { block: "onepole", inputs: { signal: "right", cutoff: { param: "tone" } } },
      backLeft: { block: "mul", inputs: { a: "dampLeft", b: "ring" } },
      backRight: { block: "mul", inputs: { a: "dampRight", b: "ring" } },
    },
    output: ["left", "right"],
  },
};

/**
 * A sidechain compressor (INST-36.7 part 5): turned down by its key, the track's sidechain input.
 * Until a project can choose a key's track (DAW-63) nothing keys it, and its sidechain is its own
 * input (definitions/chain.ts), so it works as a plain compressor.
 */
const sidechainCompressor: TestInstrument = {
  type: "engine-sidechain-compressor",
  label: "Sidechain Compressor (new engine)",
  schema: [
    { id: "threshold", label: "Threshold", kind: "number", min: -60, max: 0, default: -24, unit: "dB" },
    { id: "ratio", label: "Ratio", kind: "number", min: 1, max: 20, default: 8 },
    {
      id: "attack",
      label: "Attack",
      kind: "number",
      min: 0.0001,
      max: 0.2,
      default: 0.005,
      unit: "s",
      taper: "exponential",
    },
    {
      id: "release",
      label: "Release",
      kind: "number",
      min: 0.01,
      max: 2,
      default: 0.2,
      unit: "s",
      taper: "exponential",
    },
  ],
  definition: {
    format: 1,
    nodes: {
      squash: {
        block: "keyedcompressor",
        inputs: {
          left: "input.left",
          right: "input.right",
          keyLeft: "input.sidechainLeft",
          keyRight: "input.sidechainRight",
          threshold: { param: "threshold" },
          ratio: { param: "ratio" },
          attack: { param: "attack" },
          release: { param: "release" },
        },
      },
    },
    output: ["squash.left", "squash.right"],
  },
};

export const TEST_EFFECTS = [echo, resonator, sidechainCompressor];

/** Put the test instruments and effects in the library, as engine devices. */
export const registerTestInstruments = (): void => {
  TEST_INSTRUMENTS.forEach(({ type, label, family = "Synths", schema, definition }) => {
    const plan = compileDefinition(definition, { params: schema });
    registerEngineDevice(type, { definition, schema });
    registerInstrument({ type, label, schema, family, custom: true });
    registerInstrumentFactory(type, (context, store) => new EngineInstrument(context, plan, storeParams(plan, store)));
  });
  TEST_EFFECTS.forEach(({ type, label, schema, definition }) => {
    registerEngineDevice(type, { definition, schema });
    registerEffect({ type, label, schema, custom: true });
    // Made through a chain of one, so its mix and bypass are in its plan as in any run.
    registerEffectFactory(
      type,
      (context, store, place) =>
        runEffects(context, [{ id: type, type, bypassed: false, params: store }], () => place.stage)[0],
    );
  });
};
