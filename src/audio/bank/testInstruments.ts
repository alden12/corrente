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
      // Two periods, in seconds (near enough at 44.1 kHz too).
      burstTime: { block: "mul", voice: true, inputs: { a: "period", b: 2 / 48000 } },
      burst: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.001, decay: "burstTime", sustain: 0, release: 0.001 },
      },
      excite: { block: "mul", voice: true, inputs: { a: "exciter", b: "burst" } },
      period: { block: "period", voice: true, inputs: { frequency: "voice.frequency", offset: 0.5 } },
      string: { block: "delay", voice: true, inputs: { signal: ["excite", "feedback"], length: "period" } },
      // Brightness, plus six times the note: high notes stay bright.
      keyed: { block: "mul", voice: true, inputs: { a: "voice.frequency", b: 6 } },
      damping: {
        block: "onepole",
        voice: true,
        inputs: { signal: "string", cutoff: [{ param: "brightness" }, "keyed"] },
      },
      ring: { block: "loopgain", voice: true, inputs: { period: "period", time: { param: "decay" } } },
      feedback: { block: "mul", voice: true, inputs: { a: "damping", b: "ring" } },
    },
    voice: "string",
  },
};

/** A saw through a filter every voice shares one LFO on, into a reverb on the voices summed. */
const wobble: TestInstrument = {
  type: "engine-wobble",
  label: "Wobble (new engine)",
  schema: [
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
    { id: "rate", label: "Rate", kind: "number", min: 0.1, max: 12, default: 2, unit: "Hz", taper: "exponential" },
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
      lfo: { block: "lfo", inputs: { rate: { param: "rate" } } },
      sweep: { block: "mul", inputs: { a: "lfo.sine", b: { param: "wobble" } } },
      osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
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
      cutoff: { block: "pitch", voice: true, inputs: { frequency: { param: "cutoff" }, semitones: "sweep" } },
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
