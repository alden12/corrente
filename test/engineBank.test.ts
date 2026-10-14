import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngineBank, PlanRejected } from "../src/audio/bank/bank";
import { EVENT, EventQueue } from "../src/audio/bank/events";
import { BLOCK } from "../src/audio/bank/exports";
import { TEST_EFFECTS, TEST_INSTRUMENTS } from "../src/audio/bank/testInstruments";
import { VoiceAllocator } from "../src/audio/bank/voices";
import { compileDefinition } from "../src/audio/definitions/compile";
import type { DeviceDefinition } from "../src/audio/definitions/format";
import { buildBanks } from "../src/audio/dsp/wavetable";
import { tableOf } from "../src/audio/samples/tables";

/**
 * The engine bank (INST-36.5): the audio thread's JavaScript beside engine.wasm. Its event queue and
 * voice allocator on their own, then the bank playing compiled definitions in the real engine:
 * notes on their exact sample, voices stolen in the right order, params, tracks kept apart.
 */
const RATE = 48000;
const wasm = readFileSync(fileURLToPath(new URL("../engine/engine.wasm", import.meta.url)));
const SAMPLE = 1 / RATE;

describe("EventQueue", () => {
  const drain = (queue: EventQueue, before = Infinity) => {
    const taken: [number, number][] = [];
    for (let event = queue.next(before); event; event = queue.next(before)) taken.push([event.target, event.time]);
    return taken;
  };

  it("hands events out in time order, keeping the sent order at equal times", () => {
    const queue = new EventQueue();
    [
      [1, 0.5],
      [2, 0.1],
      [3, 0.5],
      [4, 0.3],
    ].forEach(([target, time]) => queue.add(EVENT.noteOn, 0, target, 1, time));
    expect(drain(queue)).toEqual([
      [2, 0.1],
      [4, 0.3],
      [1, 0.5],
      [3, 0.5],
    ]);
  });

  it("only hands out events before the time asked", () => {
    const queue = new EventQueue();
    queue.add(EVENT.noteOn, 0, 1, 1, 0.1);
    queue.add(EVENT.noteOn, 0, 2, 1, 0.2);
    expect(drain(queue, 0.2)).toEqual([[1, 0.1]]);
    expect(queue.size).toBe(1);
  });

  it("grows past its capacity and drops one track's events", () => {
    const queue = new EventQueue(4);
    Array.from({ length: 10 }, (_, index) => queue.add(EVENT.noteOn, index % 2, index, 1, index));
    queue.clear(1);
    expect(drain(queue).map(([target]) => target)).toEqual([0, 2, 4, 6, 8]);
  });

  it("reuses the space of events taken", () => {
    const queue = new EventQueue(4);
    Array.from({ length: 20 }, (_, index) => {
      queue.add(EVENT.noteOn, 0, index, 1, index);
      if (index >= 2) queue.next(Infinity);
    });
    expect(drain(queue).map(([target]) => target)).toEqual([18, 19]);
  });
});

describe("VoiceAllocator", () => {
  /** An allocator and a stand-in engine: a slot sounds from its note on until `finish`es it. */
  const allocator = (slots: number, voices: number) => {
    const allocated = new VoiceAllocator(slots, voices);
    const busy = new Set<number>();
    const sounding = (slot: number) => busy.has(slot);
    const play = (note: number, time: number) => {
      const slot = allocated.noteOn(note, 1, time, sounding);
      busy.add(slot);
      return { slot, cut: allocated.cut };
    };
    return { allocated, play, finish: (slot: number) => busy.delete(slot) };
  };

  it("takes free slots, and cuts a sounding note's copy to start it again", () => {
    const { play } = allocator(4, 2);
    expect(play(60, 0)).toEqual({ slot: 0, cut: -1 });
    expect(play(64, 1)).toEqual({ slot: 1, cut: -1 });
    // Slot 0 fades out while the note starts again in a spare.
    expect(play(60, 2)).toEqual({ slot: 2, cut: 0 });
  });

  it("past its voices, cuts the one released longest ago, then the oldest held", () => {
    const { allocated, play } = allocator(5, 3);
    [60, 62, 64].forEach((note, time) => play(note, time));
    allocated.noteOff(64, 3);
    allocated.noteOff(62, 4);
    expect(play(65, 5)).toEqual({ slot: 3, cut: 2 });
    expect(play(67, 6)).toEqual({ slot: 4, cut: 1 });
    // Every slot is busy or fading: the one cut longest ago is taken over.
    expect(play(69, 7)).toEqual({ slot: 1, cut: 0 });
  });

  it("uses a slot again once its cut has finished", () => {
    const { play, finish } = allocator(3, 1);
    play(60, 0);
    expect(play(62, 1)).toEqual({ slot: 1, cut: 0 });
    finish(0);
    expect(play(64, 2)).toEqual({ slot: 0, cut: 1 });
  });

  it("ignores the note off of a cut note", () => {
    const { allocated, play } = allocator(2, 1);
    play(60, 0);
    play(62, 1);
    expect(allocated.noteOff(60, 2)).toBe(-1);
    expect(allocated.noteOff(62, 2)).toBe(1);
  });
});

describe("EngineBank", () => {
  /**
   * Each voice plays 1 while its key is down, which the engine scales by velocity into the sum: what
   * lands where is plain to read.
   */
  const gated: DeviceDefinition = {
    format: 1,
    voices: 2,
    nodes: {
      vca: { block: "mul", voice: true, inputs: { a: "voice.gate", b: 1 } },
      level: { block: "mul", inputs: { a: "voices.left", b: { param: "level", scale: 2 } } },
    },
    voice: "vca",
    output: "level",
  };
  const plan = compileDefinition(gated, {
    params: [{ id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.5 }],
  });

  /** Render `blocks` blocks from time 0, returning a track's left channel. */
  const render = (bank: EngineBank, blocks: number, track = 0, from = 0) =>
    Array.from({ length: blocks }, (_, block) => {
      bank.process((from + block * BLOCK) / RATE);
      return Array.from(bank.output(track, 0));
    }).flat();

  const bankOf = (tracks = 1) => {
    const bank = new EngineBank(wasm, RATE, tracks);
    Array.from({ length: tracks }, (_, track) => bank.load(track, plan, { level: 0.5 }));
    return bank;
  };

  it("starts and ends notes on their sample", () => {
    const bank = bankOf();
    bank.noteOn(0, 60, 0.8, 37 * SAMPLE);
    bank.noteOff(0, 60, 300 * SAMPLE);
    const sound = render(bank, 4);
    expect(sound.findIndex((sample) => sample !== 0)).toBe(37);
    expect(sound[37]).toBeCloseTo(0.8, 6);
    expect(sound.slice(37, 300).every((sample) => Math.abs(sample - 0.8) < 1e-6)).toBe(true);
    expect(sound.slice(300).every((sample) => sample === 0)).toBe(true);
  });

  it("plays notes sent ahead, and late ones at the start of the block", () => {
    const bank = bankOf();
    bank.noteOn(0, 60, 1, 1000 * SAMPLE);
    expect(render(bank, 4).every((sample) => sample === 0)).toBe(true);
    expect(render(bank, 4, 0, 4 * BLOCK).findIndex((sample) => sample !== 0)).toBe(1000 - 4 * BLOCK);
    const late = bankOf();
    late.noteOn(0, 60, 1, 0);
    expect(render(late, 1, 0, BLOCK)[0]).toBeCloseTo(1, 6);
  });

  it("fades a stolen voice out while the new note starts on time", () => {
    const bank = bankOf();
    bank.noteOn(0, 60, 0.25, 0);
    bank.noteOn(0, 62, 0.25, 0);
    bank.noteOn(0, 64, 0.5, 10 * SAMPLE);
    bank.noteOff(0, 60, 20 * SAMPLE);
    const sound = render(bank, 2);
    // Two voices of a quarter; at 10, 64 starts at a half and 60 (the oldest) fades over a block.
    expect(sound[5]).toBeCloseTo(0.5, 6);
    expect(sound[10]).toBeCloseTo(0.25 + 0.5 + 0.25 * (1 - 1 / BLOCK), 5);
    expect(sound[10 + BLOCK / 2]).toBeCloseTo(0.25 + 0.5 + 0.25 * (1 - (BLOCK / 2 + 1) / BLOCK), 5);
    // Faded out a block on; 60's note off finds nothing to release.
    expect(sound[10 + BLOCK + 5]).toBeCloseTo(0.75, 6);
    expect(bank.activeVoices(0)).toBe(2);
  });

  it("carries held notes into a new plan, crossfading over a block", () => {
    const bank = bankOf();
    bank.noteOn(0, 60, 1, 0);
    render(bank, 1);
    bank.load(0, plan, { level: 0.25 });
    const sound = render(bank, 2, 0, BLOCK);
    // From the old plan's level (1) to the new one's (0.5), the note held throughout.
    expect(sound[0]).toBeCloseTo(1 - 0.5 / BLOCK, 5);
    expect(sound[BLOCK / 2 - 1]).toBeCloseTo(0.75, 5);
    expect(sound.slice(BLOCK).every((sample) => Math.abs(sample - 0.5) < 1e-6)).toBe(true);
  });

  it("moves a param over the block it lands in", () => {
    const bank = bankOf();
    bank.noteOn(0, 60, 1, 0);
    render(bank, 1);
    bank.setParam(0, "level", 0.25, BLOCK * SAMPLE + 50 * SAMPLE);
    const sound = render(bank, 2, 0, BLOCK);
    expect(sound[0]).toBeGreaterThan(0.5);
    expect(sound[BLOCK - 1]).toBeCloseTo(0.5, 2);
    expect(sound.slice(BLOCK).every((sample) => Math.abs(sample - 0.5) < 1e-6)).toBe(true);
  });

  it("releases every held note on all notes off", () => {
    const bank = bankOf();
    bank.noteOn(0, 60, 0.5, 0);
    bank.noteOn(0, 64, 0.5, 0);
    bank.allNotesOff(0, 64 * SAMPLE);
    const sound = render(bank, 2);
    expect(sound[63]).toBeCloseTo(1, 6);
    expect(sound.slice(64).every((sample) => sample === 0)).toBe(true);
    expect(bank.silent(0)).toBe(true);
  });

  it("keeps tracks apart", () => {
    const bank = bankOf(2);
    bank.noteOn(1, 60, 1, 0);
    bank.process(0);
    expect(Array.from(bank.output(0, 0)).every((sample) => sample === 0)).toBe(true);
    expect(bank.output(1, 0)[0]).toBeCloseTo(1, 6);
    expect(bank.output(1, 1)[0]).toBeCloseTo(1, 6);
  });

  it("keeps its views of the engine's memory when a big plan grows it", () => {
    const bank = bankOf(2);
    const verb = compileDefinition({
      format: 1,
      nodes: { verb: { block: "reverb", inputs: { left: "input.left", right: "input.right" } } },
      output: ["verb.left", "verb.right"],
    });
    const before = bank.engine.memory.buffer.byteLength;
    bank.load(1, verb);
    expect(bank.engine.memory.buffer.byteLength).toBeGreaterThan(before);
    bank.noteOn(0, 60, 1, 0);
    bank.process(0);
    expect(bank.output(0, 0)[0]).toBeCloseTo(1, 6);
  });

  it("refuses a plan the engine rejects, leaving the track playing the one it had", () => {
    const bank = bankOf();
    expect(() => bank.load(0, { ...plan, words: plan.words.slice(0, 5) })).toThrow(PlanRejected);
    bank.noteOn(0, 60, 1, 0);
    bank.process(0);
    expect(bank.output(0, 0)[0]).toBeCloseTo(1, 6);
  });

  it("counts the beat from where the transport was told it is", () => {
    const bank = new EngineBank(wasm, RATE, 1);
    bank.load(0, compileDefinition({ format: 1, nodes: {}, output: "host.beat" }));
    bank.setTransport({ time: 0, beat: 4, tempo: 120, playing: true });
    bank.process(0.5);
    // Half a second at 120 beats a minute is a beat on.
    expect(bank.output(0, 0)[0]).toBeCloseTo(5, 4);
  });

  describe("samples", () => {
    const sampler = compileDefinition({
      format: 1,
      nodes: {
        player: {
          block: "sampler",
          voice: true,
          inputs: { frequency: "voice.frequency", gate: "voice.gate", sample: { param: "sound" }, root: 60 },
        },
      },
      voice: ["player.left", "player.right"],
    });
    // A second of stereo, big enough to grow the memory: a ramp on the left, its negative on the right.
    const ramp = Float32Array.from({ length: RATE }, (_, frame) => frame / RATE);
    const stereo = { channels: [ramp, ramp.map((value) => -value)], rate: RATE };

    it("plays the sample a param names, pitched by the note", () => {
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, sampler);
      const before = bank.engine.memory.buffer.byteLength;
      bank.setSample(0, "sound", "ramp", stereo);
      expect(bank.engine.memory.buffer.byteLength).toBeGreaterThan(before);
      // An octave above the root reads two frames a sample.
      bank.noteOn(0, 72, 1, 0);
      bank.process(0);
      expect(bank.output(0, 0)[10]).toBeCloseTo(20 / RATE, 6);
      expect(bank.output(0, 1)[10]).toBeCloseTo(-20 / RATE, 6);
    });

    it("keeps one copy of a sample however many tracks play it, freeing it after the last", () => {
      const bank = new EngineBank(wasm, RATE, 2);
      [0, 1].forEach((track) => bank.load(track, sampler));
      bank.setSample(0, "sound", "ramp", stereo);
      bank.setSample(1, "sound", "ramp", null);
      expect(bank.samplesHeld).toBe(1);
      bank.noteOn(1, 60, 1, 0);
      bank.process(0);
      expect(bank.output(1, 0)[10]).toBeCloseTo(10 / RATE, 6);
      bank.setSample(0, "sound", "", null);
      expect(bank.samplesHeld).toBe(1);
      bank.unload(1);
      expect(bank.samplesHeld).toBe(0);
    });

    it("plays nothing until a sample param names one", () => {
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, sampler);
      bank.noteOn(0, 60, 1, 0);
      bank.process(0);
      expect(bank.output(0, 0).every((sample) => sample === 0)).toBe(true);
    });

    it("keeps a track's sample through a new plan", () => {
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, sampler);
      bank.setSample(0, "sound", "ramp", stereo);
      bank.load(0, sampler);
      // After the block the new plan fades in over.
      bank.noteOn(0, 60, 1, BLOCK * SAMPLE);
      bank.process(0);
      bank.process(BLOCK * SAMPLE);
      expect(bank.output(0, 0)[10]).toBeCloseTo(10 / RATE, 6);
    });

    describe("zones", () => {
      /** Low keys play `low`, at their own pitch from 48; soft high notes `soft`, hard ones `hard`'s second half. */
      const zoned = compileDefinition({
        format: 1,
        zones: [
          { sample: { param: "low" }, root: 48, keys: [0, 59] },
          { sample: { param: "soft" }, root: 60, keys: [60, 72], velocities: [0, 0.5] },
          { sample: { param: "hard" }, root: 60, keys: [60, 72], velocities: [0.5, 1], start: 0.5 },
        ],
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
        },
        voice: "player.left",
      });
      /** A second of one value. */
      const flat = (value: number) => ({ channels: [new Float32Array(RATE).fill(value)], rate: RATE });
      const zonedBank = () => {
        const bank = new EngineBank(wasm, RATE, 1);
        bank.load(0, zoned);
        bank.setSample(0, "low", "low", flat(0.1));
        bank.setSample(0, "soft", "soft", flat(0.2));
        bank.setSample(0, "hard", "hard", { channels: [ramp], rate: RATE });
        return bank;
      };
      /** What one note alone plays, a block of it. */
      const played = (note: number, velocity: number) => {
        const bank = zonedBank();
        bank.noteOn(0, note, velocity, 0);
        bank.process(0);
        return Array.from(bank.output(0, 0));
      };

      it("plays each note the first zone it fits, by key and velocity", () => {
        expect(played(48, 1)[10]).toBeCloseTo(0.1, 6);
        expect(played(64, 0.3)[10]).toBeCloseTo(0.2 * 0.3, 6);
        // Hard: the ramp from halfway, at its own speed on 60 (the voice is scaled by velocity).
        expect(played(60, 1)[10]).toBeCloseTo(0.5 + 10 / RATE, 6);
      });

      it("lets a note no zone fits go by without a sound or a voice", () => {
        const bank = zonedBank();
        bank.noteOn(0, 80, 1, 0);
        bank.process(0);
        expect(bank.output(0, 0).every((sample) => sample === 0)).toBe(true);
        expect(bank.engine.eng_voice_active(0, 0)).toBe(0);
      });

      it("restarts held notes in their zones in a new plan", () => {
        const bank = zonedBank();
        bank.noteOn(0, 48, 1, 0);
        bank.process(0);
        bank.load(0, zoned);
        bank.process(BLOCK * SAMPLE);
        bank.process(2 * BLOCK * SAMPLE);
        expect(bank.output(0, 0)[10]).toBeCloseTo(0.1, 6);
      });
    });

    it("plays a wavetable at the note's pitch, morphing by position", () => {
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(
        0,
        compileDefinition({
          format: 1,
          nodes: {
            osc: {
              block: "wavetable",
              voice: true,
              inputs: { frequency: "voice.frequency", position: 0, table: { param: "table" } },
            },
          },
          voice: "osc",
        }),
      );
      // The classic set's first cycle is a sine: at A4, 440 cycles a second from phase 0.
      bank.setSample(0, "table", "classic", { channels: [tableOf(buildBanks()[0])], rate: RATE });
      bank.noteOn(0, 69, 1, 0);
      bank.process(0);
      const out = Array.from(bank.output(0, 0));
      const sine = out.map((_, index) => Math.sin((2 * Math.PI * 440 * index) / RATE));
      expect(Math.max(...out.map((sample, index) => Math.abs(sample - sine[index])))).toBeLessThan(1e-3);
    });

    it("refuses a sample that won't fit, leaving the param as it was", () => {
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, sampler);
      bank.setSample(0, "sound", "ramp", stereo);
      expect(() => bank.setSample(0, "sound", "odd", { channels: [ramp, ramp.slice(1)], rate: RATE })).toThrow(
        RangeError,
      );
      expect(bank.samplesHeld).toBe(1);
      bank.noteOn(0, 60, 1, 0);
      bank.process(0);
      expect(bank.output(0, 0)[10]).toBeCloseTo(10 / RATE, 6);
    });
  });

  it("starts a new plan where the knobs are", () => {
    const bank = bankOf();
    bank.setParam(0, "level", 0.1, 0);
    bank.load(0, plan);
    bank.noteOn(0, 60, 1, 0);
    // After the block it crossfades in over.
    expect(render(bank, 2)[BLOCK]).toBeCloseTo(0.2, 6);
  });
});

describe("the new engine's test instruments", () => {
  it.each(TEST_INSTRUMENTS.map((instrument) => [instrument.type, instrument] as const))(
    "%s compiles against its params and sounds",
    (_type, { schema, definition }) => {
      const compiled = compileDefinition(definition, { params: schema });
      const defaults = Object.fromEntries(
        schema
          .filter((spec) => spec.kind !== "sample")
          .map((spec) => [spec.id, spec.kind === "number" ? spec.default : 0] as const),
      );
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, compiled, defaults);
      // Sample params get a second of a 220 Hz sine in place of the built-in (no decoder here).
      const sine = Float32Array.from(
        { length: RATE },
        (_, frame) => 0.5 * Math.sin((2 * Math.PI * 220 * frame) / RATE),
      );
      // And wavetables get the built-in classic set.
      const classic = { channels: [tableOf(buildBanks()[0])], rate: RATE };
      schema.forEach((spec) => {
        if (spec.kind === "sample")
          bank.setSample(0, spec.id, spec.id, spec.wavetable ? classic : { channels: [sine], rate: RATE });
      });
      // A kit's first pad, or A3.
      bank.noteOn(0, definition.zones?.[0].root ?? 57, 1, 0);
      const sound = Array.from({ length: 100 }, (_, block) => {
        bank.process((block * BLOCK) / RATE);
        return Array.from(bank.output(0, 0));
      }).flat();
      expect(Math.max(...sound.map(Math.abs))).toBeGreaterThan(0.05);
      expect(sound.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 4)).toBe(true);
    },
  );
});

describe("the new engine's test effects", () => {
  it.each(TEST_EFFECTS.map((effect) => [effect.type, effect] as const))(
    "%s compiles against its params and processes its input",
    (_type, { schema, definition }) => {
      const compiled = compileDefinition(definition, { params: schema });
      const defaults = Object.fromEntries(
        schema.map((spec) => [spec.id, spec.kind === "number" ? spec.default : 0] as const),
      );
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, compiled, defaults);
      // A tenth of a second of noise in, then silence: the effect rings on after it.
      const sound = Array.from({ length: 200 }, (_, block) => {
        [0, 1].forEach((channel) =>
          bank.input(0, channel).forEach((_, index, input) => (input[index] = block < 40 ? Math.random() - 0.5 : 0)),
        );
        bank.process((block * BLOCK) / RATE);
        return Array.from(bank.output(0, 0));
      }).flat();
      const after = sound.slice(60 * BLOCK);
      expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(0.01);
      expect(sound.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 4)).toBe(true);
    },
  );

  it("echoes in time with the tempo", () => {
    const echo = TEST_EFFECTS.find((effect) => effect.type === "engine-echo")!;
    const bank = new EngineBank(wasm, RATE, 1);
    bank.load(0, compileDefinition(echo.definition, { params: echo.schema }), {
      time: echo.schema[0].kind === "enum" ? echo.schema[0].options.indexOf("1/4") : 0,
      feedback: 0,
      tone: 16000,
    });
    bank.setTransport({ time: 0, beat: 0, tempo: 120, playing: true });
    // One click on the left: a quarter note at 120 is half a second later.
    const sound = Array.from({ length: 200 }, (_, block) => {
      bank.input(0, 0).fill(0);
      if (block === 0) bank.input(0, 0)[0] = 1;
      bank.process((block * BLOCK) / RATE);
      return Array.from(bank.output(0, 0));
    }).flat();
    const loudest = sound.reduce((best, sample, index) => (Math.abs(sample) > Math.abs(sound[best]) ? index : best), 0);
    expect(Math.abs(loudest - RATE / 2)).toBeLessThan(4);
  });
});
