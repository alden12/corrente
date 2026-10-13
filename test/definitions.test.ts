import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DefinitionError, compileDefinition, type CompiledPlan } from "../src/audio/definitions/compile";
import type { DeviceDefinition } from "../src/audio/definitions/format";

/**
 * The plan compiler (INST-36.4): definitions compiled and played in the committed engine.wasm, so a
 * plan the compiler writes is one the engine accepts and sounds as it should; and definitions it
 * must refuse, with problems that say what to fix.
 */
interface EngineExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  eng_malloc(bytes: number): number;
  eng_free(pointer: number): void;
  eng_init(sampleRate: number, tracks: number): number;
  eng_load(track: number, plan: number, length: number): number;
  eng_init_param(track: number, source: number, value: number): void;
  eng_note_on(track: number, slot: number, offset: number, frequency: number, velocity: number): void;
  eng_note_off(track: number, slot: number, offset: number): void;
  eng_input(track: number, channel: number): number;
  eng_output(track: number, channel: number): number;
  eng_process(): void;
}

const RATE = 48000;
const wasm = readFileSync(fileURLToPath(new URL("../engine/engine.wasm", import.meta.url)));

/** An engine of one track playing a compiled plan, its params set from `values` (by param name). */
const playing = (compiled: CompiledPlan, values: Record<string, number> = {}) => {
  const engine = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports as unknown as EngineExports;
  engine._initialize();
  engine.eng_init(RATE, 1);
  const pointer = engine.eng_malloc(compiled.words.length * 4);
  new Int32Array(engine.memory.buffer, pointer, compiled.words.length).set(compiled.words);
  expect(engine.eng_load(0, pointer, compiled.words.length)).toBe(0);
  engine.eng_free(pointer);
  compiled.params.forEach((source, index) =>
    engine.eng_init_param(0, index, (values[source.param] ?? 0) * source.scale + source.offset),
  );
  /** Render `blocks` blocks, returning the left channel; `input` fills the main input first. */
  const render = (blocks: number, input?: (sample: number) => number) =>
    Array.from({ length: blocks }, (_, block) => {
      if (input) {
        const samples = new Float32Array(engine.memory.buffer, engine.eng_input(0, 0), 128);
        samples.forEach((_, index) => (samples[index] = input(block * 128 + index)));
      }
      engine.eng_process();
      return Array.from(new Float32Array(engine.memory.buffer, engine.eng_output(0, 0), 128));
    }).flat();
  return { engine, render };
};

const peakOf = (samples: number[]) => Math.max(...samples.map(Math.abs));

/**
 * The pitch of a stretch of sound: the lag (between 50 Hz and 2 kHz) at which it best matches itself,
 * refined between samples. Counting zero crossings overcounts a sound rich in harmonics.
 */
const pitchOf = (samples: number[]) => {
  const window = samples.slice(0, 4096);
  const match = (lag: number) =>
    window.slice(0, window.length - lag).reduce((sum, sample, index) => sum + sample * window[index + lag], 0) /
    (window.length - lag);
  const lags = Array.from({ length: RATE / 50 - RATE / 2000 }, (_, index) => RATE / 2000 + index);
  const scores = lags.map(match);
  // The first lag that comes within 90% of the best, so a whole period wins over two of them.
  const best = Math.max(...scores);
  const at = scores.findIndex(
    (score, index) =>
      score >= 0.9 * best && score >= (scores[index - 1] ?? -Infinity) && score >= (scores[index + 1] ?? -Infinity),
  );
  const [before, here, after] = [scores[at - 1], scores[at], scores[at + 1]];
  const shift = (before - after) / (2 * (before - 2 * here + after));
  return RATE / (lags[at] + shift);
};

const problemsOf = (definition: unknown, params?: string[]) => {
  try {
    compileDefinition(definition, { params });
    return [];
  } catch (error) {
    if (error instanceof DefinitionError) return error.problems;
    throw error;
  }
};

/** A saw through a resonant low-pass swept by an envelope, into a VCA: today's Subtractive. */
const subtractive: DeviceDefinition = {
  format: 1,
  nodes: {
    osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
    filterEnv: { block: "adsr", voice: true, inputs: { gate: "voice.gate", attack: 0.01, decay: 0.3, sustain: 0.2 } },
    envDepth: { block: "mul", voice: true, inputs: { a: "filterEnv", b: { param: "envelope", scale: 48 } } },
    cutoff: { block: "pitch", voice: true, inputs: { frequency: { param: "cutoff" }, semitones: "envDepth" } },
    filter: { block: "lowpass", voice: true, inputs: { signal: "osc", cutoff: "cutoff", q: { param: "resonance" } } },
    ampEnv: { block: "adsr", voice: true, inputs: { gate: "voice.gate" } },
    vca: { block: "mul", voice: true, inputs: { a: "filter", b: "ampEnv" } },
  },
  voice: "vca",
};

/**
 * Karplus-Strong: a burst of noise into a delay one period long, fed back through a damping filter.
 * Every path round the loop passes through the delay, so it runs in chunks, and tunes to any pitch.
 */
const pluck: DeviceDefinition = {
  format: 1,
  nodes: {
    exciter: { block: "noise", voice: true },
    burst: {
      block: "adsr",
      voice: true,
      inputs: { gate: "voice.gate", attack: 0.001, decay: 0.012, sustain: 0, release: 0.001 },
    },
    excite: { block: "mul", voice: true, inputs: { a: "exciter", b: "burst" } },
    // One period, less the damping filter's lag of about half a sample.
    period: { block: "period", voice: true, inputs: { frequency: "voice.frequency", offset: 0.5 } },
    string: { block: "delay", voice: true, inputs: { signal: ["excite", "feedback"], length: "period" } },
    damping: { block: "onepole", voice: true, inputs: { signal: "string", cutoff: { param: "brightness" } } },
    feedback: { block: "mul", voice: true, inputs: { a: "damping", b: 0.996 } },
  },
  voice: "string",
};

describe("compiling and playing a definition", () => {
  it("plays the subtractive voice, its filter swept by its envelope", () => {
    const compiled = compileDefinition(subtractive);
    expect(compiled.voices).toBe(8);
    expect(compiled.params.map((source) => source.param)).toEqual(["envelope", "cutoff", "resonance"]);
    const { engine, render } = playing(compiled, { envelope: 1, cutoff: 800, resonance: 2 });
    engine.eng_note_on(0, 0, 0, 220, 1);
    const sound = render(40);
    expect(peakOf(sound)).toBeGreaterThan(0.1);
    expect(sound.every(Number.isFinite)).toBe(true);
    expect(pitchOf(sound.slice(2000))).toBeCloseTo(220, -1);
  });

  it("runs a plucked string's loop in chunks, and it sounds at the note's pitch", () => {
    const compiled = compileDefinition(pluck);
    expect(compiled.steps.voice.map((step) => step.mode)).toContain("chunk-loop");
    const loop = compiled.steps.voice.find((step) => step.mode === "chunk-loop")!;
    // The delay reads first, then the rest of the loop in order, the sum of its input last.
    expect(loop.nodes).toEqual(["string", "damping", "feedback", "string.signal+1"]);
    const { engine, render } = playing(compiled, { brightness: 6000 });
    [110, 440, 1000].forEach((frequency) => {
      engine.eng_note_on(0, 0, 0, frequency, 1);
      const pitch = pitchOf(render(80).slice(4800));
      expect(Math.abs(pitch - frequency) / frequency).toBeLessThan(0.02);
    });
  });

  it("runs feedback without a delay one sample at a time", () => {
    // A sine modulating its own frequency: FM operator feedback.
    const compiled = compileDefinition({
      format: 1,
      nodes: {
        op: { block: "sine", voice: true, inputs: { frequency: ["voice.frequency", "depth"] } },
        depth: { block: "mul", voice: true, inputs: { a: "op", b: 200 } },
      },
      voice: "op",
    });
    // None is ready to go first, so the one listed first does, reading the sum's sample before.
    expect(compiled.steps.voice).toEqual([{ mode: "sample-loop", nodes: ["op", "depth", "op.frequency+1"] }]);
    const { engine, render } = playing(compiled);
    engine.eng_note_on(0, 0, 0, 220, 1);
    const sound = render(20);
    expect(peakOf(sound)).toBeGreaterThan(0.5);
    expect(sound.every((sample) => Math.abs(sample) <= 1.0001)).toBe(true);
  });

  it("puts shared nodes before or after the voices by what they hear", () => {
    // An LFO every voice shares, sweeping each voice's filter; a reverb on the voices summed.
    const compiled = compileDefinition({
      format: 1,
      voices: 4,
      nodes: {
        lfo: { block: "lfo", inputs: { rate: 2 } },
        sweep: { block: "mul", inputs: { a: "lfo.sine", b: 12 } },
        osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
        cutoff: { block: "pitch", voice: true, inputs: { frequency: 2000, semitones: "sweep" } },
        filter: { block: "svf", voice: true, inputs: { signal: "osc", cutoff: "cutoff" } },
        gate: { block: "mul", voice: true, inputs: { a: "filter.lowpass", b: "voice.gate" } },
        verb: { block: "reverb", inputs: { left: "voices.left", right: "voices.right", mix: 0.3 } },
      },
      voice: "gate",
      output: ["verb.left", "verb.right"],
    });
    const sections = Object.fromEntries(
      Object.entries(compiled.steps).map(([section, steps]) => [section, steps.flatMap((step) => step.nodes).sort()]),
    );
    expect(sections).toEqual({ pre: ["lfo", "sweep"], voice: ["cutoff", "filter", "gate", "osc"], post: ["verb"] });
    const { engine, render } = playing(compiled);
    engine.eng_note_on(0, 0, 0, 110, 1);
    engine.eng_note_on(0, 1, 0, 165, 1);
    const sound = render(40);
    expect(peakOf(sound)).toBeGreaterThan(0.05);
    expect(sound.every(Number.isFinite)).toBe(true);
  });

  it("compiles an effect: no voices, the track's input in and out", () => {
    const compiled = compileDefinition({
      format: 1,
      nodes: { gain: { block: "mul", inputs: { a: "input.left", b: { param: "level" } } } },
      output: "gain",
    });
    expect(compiled.voices).toBe(0);
    const { render } = playing(compiled, { level: 0.5 });
    expect(render(1, () => 0.8).every((sample) => Math.abs(sample - 0.4) < 1e-6)).toBe(true);
  });

  it("binds a param once however many inputs read it, with its scale and offset", () => {
    const compiled = compileDefinition({
      format: 1,
      nodes: {
        a: { block: "mul", inputs: { a: { param: "level" }, b: { param: "level" } } },
        b: { block: "mul", inputs: { a: "a", b: { param: "level", scale: 2, offset: 1 } } },
      },
      output: "b",
    });
    expect(compiled.params).toEqual([
      { param: "level", scale: 1, offset: 0 },
      { param: "level", scale: 2, offset: 1 },
    ]);
  });
});

describe("definitions the compiler refuses", () => {
  const voiceWith = (nodes: DeviceDefinition["nodes"], voice = "x") => ({ format: 1, nodes, voice });

  it("says what's wrong with the shape", () => {
    expect(problemsOf({ format: 2, nodes: {} })).toEqual([expect.stringMatching(/^format: /)]);
    expect(problemsOf({ format: 1, nodes: { "bad.name": { block: "saw" } } })).toEqual([
      "bad.name: node names are a letter then letters, digits and _",
    ]);
    expect(problemsOf({ format: 1, nodes: { x: { block: "saw", extra: 1 } } })).toEqual([
      "x.frequency: not wired (every audio input needs a value, a param or a connection)",
      'x: a node has no "extra" (it has block, voice and inputs)',
    ]);
  });

  it("names unknown blocks and inputs, and what there is instead", () => {
    expect(
      problemsOf(
        voiceWith({
          x: { block: "sawtooth", voice: true },
          y: { block: "saw", voice: true, inputs: { freq: 440, frequency: "voice.frequency" } },
        }),
      ),
    ).toEqual(['x: there is no block "sawtooth"', 'y: a saw has no input "freq" (it has frequency)']);
  });

  it("names references to nothing, against the input they're in", () => {
    expect(
      problemsOf({
        format: 1,
        nodes: {
          y: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
          z: { block: "mul", voice: true, inputs: { a: "y.left", b: [1, "nowhere"] } },
        },
        voice: "z",
        output: "verb",
      }),
    ).toEqual([
      'z.a: y (a saw) has no output "left" (it has signal)',
      'z.b: "nowhere" is not a node or a signal',
      'output: "verb" is not a node or a signal',
    ]);
  });

  it("asks for every audio input, and checks numbers against their range", () => {
    expect(problemsOf(voiceWith({ x: { block: "mul", voice: true, inputs: { a: 1 } } }))).toEqual([
      "x.b: not wired (every audio input needs a value, a param or a connection)",
    ]);
    expect(
      problemsOf(voiceWith({ x: { block: "lowpass", voice: true, inputs: { signal: 0, cutoff: 50000 } } })),
    ).toEqual(["x.cutoff: 50000 is outside 20..20000"]);
  });

  it("keeps each section to what it can read", () => {
    expect(
      problemsOf({
        format: 1,
        nodes: {
          shared: { block: "mul", inputs: { a: "voice.gate", b: 1 } },
          perVoice: { block: "mul", voice: true, inputs: { a: "voices.left", b: 1 } },
          after: { block: "mul", inputs: { a: "voices.left", b: 1 } },
          late: { block: "mul", voice: true, inputs: { a: "after", b: 1 } },
          oneVoice: { block: "mul", inputs: { a: "late", b: 1 } },
        },
        voice: "late",
      }),
    ).toEqual([
      "shared isn't a voice node, so it can't read a voice's signals",
      "perVoice is a voice node, so it can't hear the voices summed",
      "late is a voice node, so it can't read after, which runs after the voices",
      "oneVoice isn't a voice node, so it can't read late, which is: read voices.left and voices.right, the voices summed",
    ]);
  });

  it("wants the voices and the track to play something", () => {
    expect(problemsOf({ format: 1, nodes: { x: { block: "noise", voice: true } } })).toEqual([
      "voice: the voices play nothing (name what each voice plays)",
    ]);
    expect(problemsOf({ format: 1, nodes: { x: { block: "noise" } } })).toEqual([
      "output: the track plays nothing (name its output)",
    ]);
  });

  it("checks params against the device's, and keeps signal names for signals", () => {
    expect(
      problemsOf(voiceWith({ x: { block: "mul", voice: true, inputs: { a: { param: "volume" }, b: 1 } } }), ["level"]),
    ).toEqual(['x.a: there is no param "volume" (the device has level)']);
    expect(problemsOf(voiceWith({ voice: { block: "noise", voice: true } }, "voice"))).toContain(
      "voice: the name is kept for signals (voice, voices, input)",
    );
  });
});
