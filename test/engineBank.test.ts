import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngineBank, PlanRejected } from "../src/audio/bank/bank";
import { EVENT, EventQueue } from "../src/audio/bank/events";
import { BLOCK } from "../src/audio/bank/exports";
import { TEST_INSTRUMENTS } from "../src/audio/bank/testInstruments";
import { VoiceAllocator } from "../src/audio/bank/voices";
import { compileDefinition } from "../src/audio/definitions/compile";
import type { DeviceDefinition } from "../src/audio/definitions/format";

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
  const silent = () => false;

  it("takes free slots, and restrikes a note's own slot", () => {
    const voices = new VoiceAllocator(3);
    expect(voices.noteOn(60, 0, silent)).toBe(0);
    expect(voices.noteOn(64, 1, silent)).toBe(1);
    expect(voices.noteOn(60, 2, silent)).toBe(0);
  });

  it("steals the slot released longest ago, then the oldest held", () => {
    const voices = new VoiceAllocator(3);
    const sounding = () => true;
    [60, 62, 64].forEach((note, time) => voices.noteOn(note, time, sounding));
    voices.noteOff(64, 3);
    voices.noteOff(62, 4);
    expect(voices.noteOn(65, 5, sounding)).toBe(2);
    expect(voices.noteOn(67, 6, sounding)).toBe(1);
    expect(voices.noteOn(69, 7, sounding)).toBe(0);
  });

  it("ignores the note off of a stolen note", () => {
    const voices = new VoiceAllocator(1);
    voices.noteOn(60, 0, () => true);
    voices.noteOn(62, 1, () => true);
    expect(voices.noteOff(60, 2)).toBe(-1);
    expect(voices.noteOff(62, 2)).toBe(0);
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
  const plan = compileDefinition(gated, { params: ["level"] });

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

  it("steals a voice past the plan's count, and a stolen note's off leaves the new note playing", () => {
    const bank = bankOf();
    bank.noteOn(0, 60, 0.25, 0);
    bank.noteOn(0, 62, 0.25, 0);
    bank.noteOn(0, 64, 0.5, 10 * SAMPLE);
    bank.noteOff(0, 60, 20 * SAMPLE);
    const sound = render(bank, 1);
    // Two voices of a quarter, then the oldest (60) is taken for 64: a quarter plus a half.
    expect(sound[5]).toBeCloseTo(0.5, 6);
    expect(sound[15]).toBeCloseTo(0.75, 6);
    expect(sound[30]).toBeCloseTo(0.75, 6);
    expect(bank.activeVoices(0)).toBe(2);
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

  it("starts a new plan where the knobs are", () => {
    const bank = bankOf();
    bank.setParam(0, "level", 0.1, 0);
    bank.load(0, plan);
    bank.noteOn(0, 60, 1, 0);
    expect(render(bank, 1)[0]).toBeCloseTo(0.2, 6);
  });
});

describe("the new engine's test instruments", () => {
  it.each(TEST_INSTRUMENTS.map((instrument) => [instrument.type, instrument] as const))(
    "%s compiles against its params and sounds",
    (_type, { schema, definition }) => {
      const compiled = compileDefinition(definition, { params: schema.map((spec) => spec.id) });
      const defaults = Object.fromEntries(
        schema.map((spec) => [spec.id, spec.kind === "number" ? spec.default : 0] as const),
      );
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, compiled, defaults);
      bank.noteOn(0, 57, 1, 0);
      const sound = Array.from({ length: 100 }, (_, block) => {
        bank.process((block * BLOCK) / RATE);
        return Array.from(bank.output(0, 0));
      }).flat();
      expect(Math.max(...sound.map(Math.abs))).toBeGreaterThan(0.05);
      expect(sound.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 4)).toBe(true);
    },
  );
});
