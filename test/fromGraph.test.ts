import { describe, expect, it } from "vitest";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { compileDefinition } from "../src/audio/definitions/compile";
import { effectFromGraph, instrumentFromGraph, type Converted } from "../src/audio/definitions/fromGraph";
import { engineDevice } from "../src/audio/definitions/engineDevices";
import { engineValueOf } from "../src/audio/definitions/values";
import { effectSchema } from "../src/audio/effects/catalog";
import { instrumentSchema } from "../src/audio/instruments/catalog";
import { BUILTIN_GRAPH_EFFECTS, BUILTIN_GRAPH_INSTRUMENTS } from "../src/audio/graph/builtins";
import type { GraphEffectDef, GraphInstrumentDef } from "../src/audio/graph/types";
import type { ParamSchema } from "../src/audio/params/types";
import { peakOf, RATE, wasm } from "./support/engine";

/**
 * The old graph format to the new definition format (INST-36.8): every built-in converts, compiles
 * and plays, and the Web Audio semantics the old engine had come across (the voice envelope, stereo,
 * units, a param plus what modulates it).
 */

/** A schema's defaults as the engine reads them. */
const defaultsOf = (schema: ParamSchema) =>
  Object.fromEntries(
    schema.flatMap((spec) => (spec.kind === "sample" ? [] : [[spec.id, engineValueOf(spec, spec.default)]])),
  );

/** A second of stereo noise-ish audio, for a sample param. */
const sampleAudio = () => ({
  channels: [0, 1].map(() => Float32Array.from({ length: RATE }, (_, frame) => Math.sin(frame * 0.05) * 0.5)),
  rate: RATE,
});

/** A converted device loaded on a bank, with any sample params given audio. */
const loaded = ({ schema, definition }: Converted) => {
  const bank = new EngineBank(wasm, RATE, 1);
  bank.load(0, compileDefinition(definition, { params: schema }), defaultsOf(schema));
  schema
    .filter((spec) => spec.kind === "sample" && !("wavetable" in spec && spec.wavetable))
    .forEach((spec) => bank.setSample(0, spec.id, "test", sampleAudio()));
  return bank;
};

/** Render `seconds`, both channels, `before` each block. */
const rendered = (bank: EngineBank, seconds: number, before: (bank: EngineBank, block: number) => void = () => {}) => {
  const channels: number[][] = [[], []];
  Array.from({ length: Math.ceil((seconds * RATE) / BLOCK) }, (_, block) => {
    before(bank, block);
    bank.process((block * BLOCK) / RATE);
    channels.forEach((channel, index) => channel.push(...bank.output(0, index)));
  });
  return channels;
};

/** A note held for half a second then let go, over a second. */
const played = (converted: Converted) => {
  const bank = loaded(converted);
  bank.noteOn(0, 57, 0.9, 0);
  bank.noteOff(0, 57, 0.5);
  return rendered(bank, 1);
};

/** Noise into the effect for a second. */
const through = (converted: Converted) =>
  rendered(loaded(converted), 1, (bank) =>
    [0, 1].forEach((channel) =>
      bank.input(0, channel).forEach((_, index, samples) => (samples[index] = Math.random() - 0.5)),
    ),
  );

const healthy = (channels: number[][]) => {
  const all = channels.flat();
  expect(all.every(Number.isFinite)).toBe(true);
  expect(peakOf(all)).toBeGreaterThan(0.01);
  expect(peakOf(all)).toBeLessThan(4);
};

/** The drum kit plays only on its pads' notes, so it has a test of its own. */
const INSTRUMENTS = BUILTIN_GRAPH_INSTRUMENTS.filter((def) => def.type !== "drumkit");
const instrumentNamed = (type: string) => BUILTIN_GRAPH_INSTRUMENTS.find((def) => def.type === type)!;
const effectNamed = (type: string) => BUILTIN_GRAPH_EFFECTS.find((def) => def.type === type)!;

describe("converting the built-ins", () => {
  it.each(INSTRUMENTS.map((def) => [def.type, def] as const))("%s converts, compiles and plays", (_, def) => {
    healthy(played(instrumentFromGraph(def)));
  });

  it.each(BUILTIN_GRAPH_EFFECTS.map((def) => [def.type, def] as const))("%s converts, compiles and plays", (_, def) => {
    healthy(through(effectFromGraph(def)));
  });

  it("plays every built-in on the engine, under the schema its projects were saved with", () => {
    BUILTIN_GRAPH_INSTRUMENTS.forEach((def) =>
      expect(engineDevice(def.type)?.schema).toEqual(instrumentSchema(def.type)),
    );
    BUILTIN_GRAPH_EFFECTS.forEach((def) => expect(engineDevice(def.type)?.schema).toEqual(effectSchema(def.type)));
  });

  it("says what sounds different: the reverb's convolution", () => {
    expect(effectFromGraph(effectNamed("reverb")).notes).toEqual([expect.stringContaining("algorithmic reverb")]);
    expect(instrumentFromGraph(instrumentNamed("subtractive")).notes).toEqual([]);
  });

  it("converts the drum kit to a zone per pad, its note, level and tune read from the pad's params", () => {
    const converted = instrumentFromGraph(instrumentNamed("drumkit"));
    expect(converted.definition.zones).toHaveLength(32);
    expect(converted.definition.zones?.[0]).toEqual({
      sample: { param: "pad1.sample" },
      root: 60,
      keys: [
        { param: "pad1.note", scale: 1 },
        { param: "pad1.note", scale: 1 },
      ],
      tune: { param: "pad1.tune", scale: 1 },
      level: { param: "pad1.level", scale: 1 },
      keytrack: false,
    });
    // A pad's note plays it; a note no pad has doesn't sound.
    const pad = (note: number) => {
      const bank = loaded(converted);
      bank.noteOn(0, note, 0.9, 0);
      return rendered(bank, 0.2)[0];
    };
    const kick = defaultsOf(converted.schema)["pad1.note"];
    expect(peakOf(pad(kick))).toBeGreaterThan(0.01);
    expect(peakOf(pad(0))).toBe(0);
  });
});

describe("what the old engine did, carried over", () => {
  const instrument = (voice: GraphInstrumentDef["voice"], schema: ParamSchema = []): GraphInstrumentDef => ({
    type: "test",
    schema,
    voice,
  });
  const effect = (graph: GraphEffectDef["graph"], schema: ParamSchema = []): GraphEffectDef => ({
    type: "test",
    schema,
    graph,
  });

  it("a voice into amp rises over env.attack to its velocity, and falls over env.release", () => {
    const schema: ParamSchema = [
      { id: "env.attack", label: "Attack", kind: "number", min: 0, max: 1000, default: 100 },
      { id: "env.release", label: "Release", kind: "number", min: 0, max: 1000, default: 100 },
    ];
    const converted = instrumentFromGraph(
      instrument({ nodes: [{ id: "one", kind: "constant", offset: 1 }], connections: [["one", "amp"]] }, schema),
    );
    const [left] = played(converted);
    // Halfway up at 50 ms, at the velocity (0.9) once it's up, down by 100 ms after the 0.5 s release.
    expect(left[RATE * 0.05]).toBeCloseTo(0.45, 1);
    expect(left[RATE * 0.3]).toBeCloseTo(0.9, 3);
    expect(Math.abs(left[RATE * 0.62])).toBeLessThan(0.01);
  });

  it("a param plus what modulates it, as Web Audio adds them", () => {
    // A gain of 0 opened by a constant of 0.5 into its gain: 0.5 of the 1 going in.
    const converted = instrumentFromGraph(
      instrument({
        nodes: [
          { id: "one", kind: "constant" },
          { id: "half", kind: "constant", offset: 0.5 },
          { id: "vca", kind: "gain", gain: 0 },
        ],
        connections: [
          ["one", "vca"],
          ["half", "vca.gain"],
          ["vca", "out"],
        ],
      }),
    );
    const [left] = played(converted);
    expect(left[RATE * 0.25]).toBeCloseTo(0.5 * 0.9, 3);
  });

  it("an effect runs a copy per channel, and its sources once", () => {
    // Tremolo-like: one LFO into two VCAs, left and right kept apart.
    const converted = effectFromGraph(effectNamed("tremolo"));
    const blocks = Object.values(converted.definition.nodes).map((node) => node.block);
    expect(blocks.filter((block) => block === "sine")).toHaveLength(1);
    expect(blocks.filter((block) => block === "mul").length).toBeGreaterThanOrEqual(2);
    const bank = loaded(converted);
    const [left, right] = rendered(bank, 0.1, (each) => {
      each.input(0, 0).fill(1);
      each.input(0, 1).fill(-1);
    });
    expect(left.slice(-100).every((sample) => sample > 0)).toBe(true);
    expect(right.slice(-100).every((sample) => sample < 0)).toBe(true);
  });

  it("a delay's time in seconds, at whatever the sample rate", () => {
    const converted = effectFromGraph(
      effect({
        nodes: [{ id: "late", kind: "delay", delayTime: 0.1 }],
        connections: [
          ["in", "late"],
          ["late", "wet"],
        ],
      }),
    );
    const [left] = rendered(loaded(converted), 0.2, (bank, block) => bank.input(0, 0).fill(block === 0 ? 1 : 0));
    expect(left.findIndex((sample) => Math.abs(sample) > 0.5)).toBe(RATE * 0.1);
  });

  it("an oscillator follows the note, times its ratio, moved by detune", () => {
    const converted = instrumentFromGraph(
      instrument({
        nodes: [{ id: "osc", kind: "osc", waveform: "square", noteRatio: 2, detune: 1200 }],
        connections: [["osc", "out"]],
      }),
    );
    // A3 (220 Hz) an octave up by its ratio and another by its detune: 880 Hz.
    const [left] = played(converted);
    const rising = left
      .slice(RATE * 0.1, RATE * 0.2)
      .flatMap((sample, index, all) => (index > 0 && all[index - 1] < 0 && sample >= 0 ? [index] : []));
    const period = (rising[rising.length - 1] - rising[0]) / (rising.length - 1);
    expect(RATE / period).toBeCloseTo(880, -1);
  });

  it("a waveform chosen by a param picks between oscillators", () => {
    const converted = instrumentFromGraph(instrumentNamed("subtractive"));
    const select = Object.values(converted.definition.nodes).find((node) => node.block === "select");
    expect(select?.inputs?.index).toEqual({ param: "osc.waveform" });
  });

  it("converts every kind the old format has, together", () => {
    // Each kind once, chained so each one is heard: sources summed, then every processor in a row,
    // then panned. Any kind's converter writing something the compiler refuses fails here.
    const schema: ParamSchema = [
      { id: "wave", label: "Wave", kind: "enum", options: ["sine", "triangle"], default: "triangle" },
      { id: "sound", label: "Sound", kind: "sample", default: "" },
    ];
    const kinds = new Set<string>();
    const voice: GraphInstrumentDef["voice"] = {
      nodes: [
        { id: "osc", kind: "osc", waveform: { param: "wave" }, detune: 7 },
        { id: "analog", kind: "analogOsc", waveform: "pulse", pulseWidth: 0.3, noteRatio: 0.5 },
        { id: "table", kind: "wavetableOsc", bank: "harmonics", position: 0.5 },
        { id: "hiss", kind: "noise", color: "pink" },
        { id: "sample", kind: "buffer", sample: { param: "sound" }, oneShot: false },
        { id: "env", kind: "env", attack: 10, release: 100 },
        { id: "bias", kind: "constant", offset: 0.1 },
        { id: "mix", kind: "gain", gain: 0.2 },
        { id: "filter", kind: "biquad", filterType: "peaking", frequency: 900, q: 2, gain: 6 },
        { id: "ladder", kind: "ladder", frequency: 3000, resonance: 0.3 },
        { id: "crush", kind: "bitcrush", bits: 12, downsample: 2 },
        { id: "shape", kind: "shaper", curve: { shape: "fold", amount: 10 } },
        { id: "echo", kind: "delay", delayTime: 0.01 },
        { id: "squash", kind: "compressor", threshold: -12, ratio: 4 },
        { id: "room", kind: "convolver", impulse: { shape: "decay", seconds: 1 } },
        { id: "place", kind: "pan", pan: 0.3 },
      ],
      connections: [
        ...["osc", "analog", "table", "hiss", "sample", "bias"].map((from): [string, string] => [from, "mix"]),
        ["env", "mix.gain"],
        ["mix", "filter"],
        ["filter", "ladder"],
        ["ladder", "crush"],
        ["crush", "shape"],
        ["shape", "echo"],
        ["echo", "squash"],
        ["squash", "room"],
        ["room", "place"],
        ["place", "amp"],
      ],
    };
    voice.nodes.forEach((spec) => kinds.add(spec.kind));
    expect(kinds.size).toBe(16);
    const converted = instrumentFromGraph(instrument(voice, schema));
    healthy(played(converted));
    // A reverb in every voice is heavy: fewer voices, so a phone can run it.
    expect(converted.notes).toEqual([
      expect.stringContaining("algorithmic reverb"),
      "it plays 8 notes at once, as many as a phone can run",
    ]);
    expect(converted.definition.voices).toBe(8);
  });

  it("names a node whose id isn't a plain word, and keeps it apart from the rest", () => {
    const converted = effectFromGraph(
      effect({
        nodes: [
          { id: "my gain", kind: "gain", gain: 0.5 },
          { id: "voice", kind: "gain", gain: 1 },
        ],
        connections: [
          ["in", "my gain"],
          ["my gain", "voice"],
          ["voice", "wet"],
        ],
      }),
    );
    expect(Object.keys(converted.definition.nodes)).toEqual(expect.arrayContaining(["my_gain_l", "voice_2_l"]));
    expect(() => compileDefinition(converted.definition, { params: converted.schema })).not.toThrow();
  });
});
