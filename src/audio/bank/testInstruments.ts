/**
 * Instruments to try the new engine with in development (INST-36.5), before any device moves over
 * (INST-36.8). Registered by devTools.ts, so they never ship: no project on the real deployment may
 * hold a new-engine device until the old format converts and retires (decided 2026-10-14). They go
 * when the built-ins convert.
 */
import { compileDefinition } from "../definitions/compile";
import type { DeviceDefinition } from "../definitions/format";
import { registerInstrument } from "../instruments/catalog";
import { registerInstrumentFactory } from "../instruments/registry";
import type { ParamSchema } from "../params/types";
import { EngineInstrument } from "./EngineInstrument";

interface TestInstrument {
  type: string;
  label: string;
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
 * its rate a note division in time with the tempo, into a reverb on the voices summed.
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
    {
      id: "rate",
      label: "Rate",
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
      // One cycle per note division, at the project's tempo.
      lfo: { block: "lfo", inputs: { rate: { beats: { param: "rate" }, as: "hz" } } },
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
        inputs: { frequency: { param: "cutoff" }, semitones: { from: "lfo.sine", scale: { param: "wobble" } } },
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

export const TEST_INSTRUMENTS = [pluck, wobble];

/** Put the test instruments in the library. */
export const registerTestInstruments = (): void =>
  TEST_INSTRUMENTS.forEach(({ type, label, schema, definition }) => {
    const plan = compileDefinition(definition, { params: schema });
    registerInstrument({ type, label, schema, family: "Synths", custom: true });
    registerInstrumentFactory(type, (context, store) => new EngineInstrument(context, store, plan));
  });
