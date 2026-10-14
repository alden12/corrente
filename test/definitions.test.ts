import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DefinitionError, compileDefinition, type CompiledPlan } from "../src/audio/definitions/compile";
import {
  HOST_SIGNALS,
  TRACK_INPUTS,
  VOICE_SIGNALS,
  VOICE_SUM,
  type DeviceDefinition,
} from "../src/audio/definitions/format";
import { EXAMPLE, definitionFormatDoc } from "../src/audio/definitions/describe";
import { CATALOGUE } from "../src/audio/definitions/catalogue";
import type { ParamSchema } from "../src/audio/params/types";
import { startEngine } from "../src/audio/bank/exports";
import { engineValueOf } from "../src/audio/definitions/values";
import { beatsOf } from "../src/audio/definitions/references";
import { resolveNumber } from "../src/audio/graph/table";

/**
 * The plan compiler (INST-36.4): definitions compiled and played in the committed engine.wasm, so a
 * plan the compiler writes is one the engine accepts and sounds as it should; and definitions it
 * must refuse, with problems that say what to fix.
 */
const RATE = 48000;
const wasm = readFileSync(fileURLToPath(new URL("../engine/engine.wasm", import.meta.url)));

/** An engine of one track playing a compiled plan, its params set from `values` (by param name). */
const playing = (compiled: CompiledPlan, values: Record<string, number> = {}) => {
  const engine = startEngine(wasm);
  engine.eng_init(RATE, 1);
  const pointer = engine.eng_malloc(compiled.words.length * 4);
  new Int32Array(engine.memory.buffer, pointer, compiled.words.length).set(compiled.words);
  expect(engine.eng_load(0, pointer, compiled.words.length)).toBe(0);
  engine.eng_free(pointer);
  compiled.params.forEach((source, index) =>
    engine.eng_init_param(0, index, resolveNumber(values[source.param] ?? 0, source)),
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

/** Number params by name, for the compiler to check bindings against. */
const numberParams = (names: string[]): ParamSchema =>
  names.map((id) => ({ id, label: id, kind: "number", min: 0, max: 1, default: 0 }));

const problemsOf = (definition: unknown, params?: string[] | ParamSchema) => {
  try {
    compileDefinition(definition, {
      params: params?.every((param) => typeof param === "string")
        ? numberParams(params as string[])
        : (params as ParamSchema),
    });
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

describe("scaled references and choices", () => {
  /** A voice playing one input while its key is down. */
  const voicePlaying = (input: DeviceDefinition["nodes"][string]["inputs"]) => ({
    format: 1 as const,
    nodes: { vca: { block: "mul", voice: true, inputs: { a: "voice.gate", ...input } } },
    voice: "vca",
  });
  const voiceNodes = (compiled: CompiledPlan) => compiled.steps.voice.flatMap((step) => step.nodes);
  /** The level a held note plays at once its first block is in. */
  const levelOf = (compiled: CompiledPlan, values: Record<string, number> = {}) => {
    const { engine, render } = playing(compiled, values);
    engine.eng_note_on(0, 0, 0, 220, 1);
    return render(1)[64];
  };

  it("scales a reference with a multiply and an offset with an add, and adds nothing for 1 and 0", () => {
    const scaled = compileDefinition(voicePlaying({ b: { from: "voice.gate", scale: 0.5, offset: 0.25 } }));
    expect(voiceNodes(scaled)).toEqual(["vca.b*", "vca.b~", "vca"]);
    expect(levelOf(scaled)).toBeCloseTo(0.75, 6);
    const plain = compileDefinition(voicePlaying({ b: { from: "voice.gate" } }));
    expect(voiceNodes(plain)).toEqual(["vca"]);
  });

  it("scales each reference in a sum on its own", () => {
    const compiled = compileDefinition(voicePlaying({ b: [{ from: "voice.gate", scale: 0.5 }, 0.1] }));
    expect(voiceNodes(compiled)).toEqual(["vca.b0*", "vca.b+1", "vca"]);
    expect(levelOf(compiled)).toBeCloseTo(0.6, 6);
  });

  it("reads a choice as its option's index, so a select block picks by it", () => {
    const wave = {
      id: "wave",
      label: "Wave",
      kind: "enum",
      options: ["low", "middle", "high"],
      default: "low",
    } as const;
    const definition: DeviceDefinition = {
      format: 1,
      nodes: {
        pick: { block: "select", voice: true, inputs: { index: { param: "wave" }, a: 0.1, b: 0.2, c: 0.3, d: 0 } },
        vca: { block: "mul", voice: true, inputs: { a: "voice.gate", b: "pick" } },
      },
      voice: "vca",
    };
    const withChoice = compileDefinition(definition, { params: [wave] });
    expect(levelOf(withChoice, { wave: engineValueOf(wave, "high") })).toBeCloseTo(0.3, 6);
    expect(levelOf(withChoice, { wave: engineValueOf(wave, "middle") })).toBeCloseTo(0.2, 6);
    expect([engineValueOf(wave, "low"), engineValueOf(undefined, true), engineValueOf(undefined, 0.4)]).toEqual([
      0, 1, 0.4,
    ]);
  });
});

describe("signals, and lengths kept in time with the tempo", () => {
  /** A track with no voices playing one input, at 120 beats a minute, playing. */
  const trackPlaying = (input: unknown, params?: ParamSchema, values: Record<string, number> = {}) => {
    const compiled = compileDefinition(
      { format: 1, nodes: { out: { block: "mul", inputs: { a: input, b: 1 } } }, output: "out" },
      { params },
    );
    const { engine, render } = playing(compiled, values);
    engine.eng_transport(0, 120, 1);
    return render(1)[64];
  };
  const rate = { id: "rate", label: "Rate", kind: "enum", options: ["1/4", "1/8", "1/8T"], default: "1/4" } as const;

  it("reads note divisions as beats", () => {
    expect([beatsOf("1/4"), beatsOf("1/8T"), beatsOf("1/8."), beatsOf("2/1"), beatsOf("1/x"), beatsOf("0/4")]).toEqual([
      1,
      1 / 3,
      0.75,
      8,
      undefined,
      undefined,
    ]);
  });

  it("turns a division into a rate or a length at the tempo", () => {
    // 120 beats a minute: an eighth is a quarter of a second, 4 a second, 12000 samples at 48 kHz.
    expect(trackPlaying({ beats: "1/8", as: "hz" })).toBeCloseTo(4, 4);
    expect(trackPlaying({ beats: "1/8", as: "seconds" })).toBeCloseTo(0.25, 6);
    expect(trackPlaying({ beats: 2, as: "samples" })).toBeCloseTo(48000, 1);
    expect(trackPlaying("host.tempo")).toBe(120);
    expect(trackPlaying("host.playing")).toBe(1);
  });

  it("follows a choice of divisions", () => {
    const at = (choice: string) =>
      trackPlaying({ beats: { param: "rate" }, as: "hz" }, [rate], { rate: engineValueOf(rate, choice) });
    expect(at("1/4")).toBeCloseTo(2, 4);
    expect(at("1/8T")).toBeCloseTo(6, 4);
  });

  it("scales a reference by a param, and reads a voice's note", () => {
    const depth = { id: "depth", label: "Depth", kind: "number", min: 0, max: 1, default: 0 } as const;
    const compiled = compileDefinition(
      {
        format: 1,
        nodes: {
          vca: {
            block: "mul",
            voice: true,
            inputs: { a: "voice.note", b: { from: "voice.gate", scale: { param: "depth" } } },
          },
        },
        voice: "vca",
      },
      { params: [depth] },
    );
    const { engine, render } = playing(compiled, { depth: 0.5 });
    engine.eng_note_on(0, 0, 0, 261.63, 1, 60);
    expect(render(1)[64]).toBeCloseTo(30, 4);
  });

  it("locks a beatlfo's phase to the beat", () => {
    // A cycle a beat long: a quarter of the way through, the sine is at its top; half way, back at 0.
    const compiled = compileDefinition({
      format: 1,
      nodes: {
        locked: { block: "beatlfo", inputs: { beat: "host.beat", length: { beats: "1/4", as: "beats" } } },
      },
      output: "locked.sine",
    });
    const at = (beat: number) => {
      const { engine, render } = playing(compiled);
      engine.eng_transport(beat, 120, 1);
      return render(1)[0];
    };
    expect(at(0.25)).toBeCloseTo(1, 3);
    expect(at(8.25)).toBeCloseTo(1, 3);
    expect(at(0.5)).toBeCloseTo(0, 3);
  });

  it("refuses what can't be kept in time", () => {
    const beats = { id: "beats", label: "Beats", kind: "number", min: 0, max: 8, default: 1 } as const;
    const odd = { ...rate, options: ["1/4", "fast"] };
    const problems = (input: unknown, params?: ParamSchema) =>
      problemsOf({ format: 1, nodes: { out: { block: "mul", inputs: { a: input, b: 1 } } }, output: "out" }, params);
    expect(problems({ beats: "1/7x", as: "hz" })).toEqual([
      'out.a: "1/7x" is not a note division (try "1/8", "1/8T" or "1/8.")',
    ]);
    expect(problems({ beats: { param: "rate" }, as: "hz" }, [odd])).toEqual([
      'out.a: rate\'s options must be note divisions ("1/8", "1/8T"), not fast',
    ]);
    expect(problems({ beats: { param: "beats" }, as: "hz" }, [beats])).toEqual([
      "out.a: a rate in hz needs beats as a choice of note divisions, not a number of beats",
    ]);
    expect(problems({ beats: { param: "beats" }, as: "seconds" }, [beats])).toEqual([]);
  });
});

describe("what a definition costs", () => {
  it("adds up its blocks once for the track and once a voice", () => {
    const voiceOf = (voices: number) =>
      compileDefinition({
        format: 1,
        voices,
        nodes: {
          osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
          verb: { block: "reverb", inputs: { left: "voices.left", right: "voices.right" } },
        },
        voice: "osc",
        output: ["verb.left", "verb.right"],
      }).cost;
    const [one, eight] = [voiceOf(1), voiceOf(8)];
    expect(one.perVoice).toBeGreaterThan(0);
    expect(eight.shared).toBe(one.shared);
    expect(eight.total).toBeCloseTo(eight.shared + 8 * eight.perVoice, 9);
  });

  it("refuses a definition a phone couldn't run", () => {
    // A reverb in every one of 64 voices.
    expect(
      problemsOf({
        format: 1,
        voices: 64,
        nodes: { verb: { block: "reverb", voice: true, inputs: { left: "voice.gate", right: "voice.gate" } } },
        voice: "verb",
      }),
    ).toEqual([
      expect.stringMatching(
        /^voices: too heavy for a phone: 64 voices at about [\d.]+% each is about [\d.]+% of its audio thread, over the 25.0% a device may take/,
      ),
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

  describe("samples (INST-36.6)", () => {
    const kit = { id: "kit", label: "Kit", kind: "sample", default: "" } as const;
    const level = { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 1 } as const;
    const playing = (sample?: unknown) =>
      voiceWith({
        x: {
          block: "sampler",
          voice: true,
          inputs: { frequency: "voice.frequency", gate: "voice.gate", ...(sample === undefined ? {} : { sample }) },
        },
      });

    it("binds a sample param to a sampler's sample, marked for the bank", () => {
      const plan = compileDefinition(playing({ param: "kit" }), { params: [kit] });
      expect(plan.params).toEqual([{ param: "kit", scale: 1, offset: 0, sample: true }]);
    });

    describe("zones", () => {
      const drum = { id: "drum", label: "Drum", kind: "sample", default: "" } as const;
      const zonedWith = (zones: unknown, sample: unknown = "voice.sample", root: unknown = "voice.root") => ({
        format: 1,
        zones,
        nodes: {
          x: {
            block: "sampler",
            voice: true,
            inputs: { frequency: "voice.frequency", gate: "voice.gate", sample, root },
          },
        },
        voice: "x",
      });

      it("fills in each zone's ranges and gives the bank its sample params", () => {
        const plan = compileDefinition(zonedWith([{ sample: { param: "drum" }, root: 36, keys: [36, 36] }]), {
          params: [drum],
        });
        expect(plan.zones).toEqual([{ param: "drum", root: 36, keys: [36, 36], velocities: [0, 1], start: 0, end: 1 }]);
        expect(plan.params).toEqual([{ param: "drum", scale: 1, offset: 0, sample: true }]);
      });

      it("checks zones, and keeps zone signals for definitions with zones", () => {
        expect(
          problemsOf(zonedWith([{ sample: { param: "level" }, root: 36, keys: [40, 36], velocities: [1, 0] }]), [
            drum,
            { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 1 },
          ]),
        ).toEqual([
          "zones[0].sample: level is a number param, not a sample",
          "zones[0].keys: the lowest key comes first",
          "zones[0].velocities: the lowest velocity comes first",
        ]);
        expect(problemsOf(zonedWith(undefined, "voice.sample", 60))).toEqual([
          "x.sample: takes a sample param as { param }, with no scale, offset or table",
        ]);
        expect(problemsOf(zonedWith(undefined, { param: "drum" }), [drum])).toEqual([
          "x.root: voice.root is the sample zone a note took, and there are no zones",
        ]);
      });
    });

    it("wants a sampler's sample to be a sample param, as it is", () => {
      expect(problemsOf(playing())).toEqual(["x.sample: needs a sample param (which sample it plays)"]);
      expect(problemsOf(playing(3))).toEqual([
        "x.sample: takes a sample param as { param }, with no scale, offset or table",
      ]);
      expect(problemsOf(playing({ param: "kit", scale: 2 }), [kit])).toEqual([
        "x.sample: takes a sample param as { param }, with no scale, offset or table",
      ]);
      expect(problemsOf(playing({ param: "level" }), [kit, level])).toEqual([
        "x.sample: level is a number param, not a sample",
      ]);
      expect(problemsOf(playing({ param: "drums" }), [kit])).toEqual([
        'x.sample: there is no param "drums" (the device has kit)',
      ]);
    });
  });

  it("checks params against the device's, and keeps signal names for signals", () => {
    expect(
      problemsOf(voiceWith({ x: { block: "mul", voice: true, inputs: { a: { param: "volume" }, b: 1 } } }), ["level"]),
    ).toEqual(['x.a: there is no param "volume" (the device has level)']);
    const kit = { id: "kit", label: "Kit", kind: "sample", default: "" } as const;
    expect(
      problemsOf(voiceWith({ x: { block: "mul", voice: true, inputs: { a: { param: "kit" }, b: 1 } } }), [kit]),
    ).toEqual(["x.a: kit is a sample param, which only feeds a sampler's sample"]);
    expect(
      problemsOf(voiceWith({ x: { block: "mul", voice: true, inputs: { a: { from: "lfo", scale: 2 }, b: 1 } } })),
    ).toEqual(['x.a: "lfo" is not a node or a signal']);
    expect(problemsOf(voiceWith({ voice: { block: "noise", voice: true } }, "voice"))).toContain(
      "voice: the name is kept for signals (voice, voices, input, host)",
    );
  });
});

describe("the format's description", () => {
  it("describes every signal and block, and its example compiles", () => {
    const doc = definitionFormatDoc();
    const signals = [VOICE_SIGNALS, VOICE_SUM, TRACK_INPUTS, HOST_SIGNALS].flatMap((group) => Object.keys(group));
    expect(Object.keys(doc.signals).sort()).toEqual(signals.sort());
    expect(doc.blocks.map((block) => block.name)).toEqual(CATALOGUE.blocks.map((block) => block.name));
    const release = { id: "release", label: "Release", kind: "number", min: 1, max: 2000, default: 200 } as const;
    const cutoff = { id: "cutoff", label: "Cutoff", kind: "number", min: 20, max: 8000, default: 900 } as const;
    expect(() => compileDefinition(EXAMPLE, { params: [release, cutoff] })).not.toThrow();
  });
});
