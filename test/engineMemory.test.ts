import { describe, expect, it } from "vitest";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { carryWords } from "../src/audio/bank/carry";
import { compileDefinition, type CompiledPlan } from "../src/audio/definitions/compile";
import { RATE, wasm } from "./support/engine";

/**
 * The engine's memory stays flat over a long session (INST-36.11). WebAssembly memory only grows, so
 * state kept past its use, or plans and samples of varying sizes leaving holes too small to reuse,
 * would show as memory that keeps climbing. This loads, unloads, plays and swaps samples for a few
 * hundred rounds and checks the memory ends the size it was after the first few.
 */

/** Voices each running a delay line of `size` samples on their gate. */
const voiced = (voices: number, size: number) =>
  compileDefinition({
    format: 1,
    voices,
    nodes: { echo: { block: "delay", voice: true, inputs: { signal: "voice.gate", length: 100, size } } },
    voice: "echo",
  });
const verb = compileDefinition({
  format: 1,
  nodes: { verb: { block: "reverb", inputs: { left: "input.left", right: "input.right" } } },
  output: ["verb.left", "verb.right"],
});
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

/** The plans round `round` loads, in turn: voices and rings of a few sizes, a reverb, a sampler. */
const PLANS: CompiledPlan[] = [voiced(8, 4000), verb, voiced(32, 48000), sampler, voiced(2, 200_000), sampler];

/** Each sample ref always names audio of one length: a quarter of a second to a second and a quarter. */
const audioOf = (ref: number) => {
  const frames = (RATE / 4) * (1 + ref);
  return { channels: [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(-0.25)], rate: RATE };
};

describe("the engine's memory over a long session", () => {
  it("stays the size it reached in the first rounds", () => {
    const bank = new EngineBank(wasm, RATE, 2);
    const loaded: (CompiledPlan | null)[] = [null, null];
    let block = 0;
    const play = (blocks: number) => {
      for (let end = block + blocks; block < end; block++) bank.process((block * BLOCK) / RATE);
    };

    const round = (index: number) => {
      const track = index % 2;
      const plan = PLANS[Math.floor(index / 2) % PLANS.length];
      const before = loaded[track];
      // The same plan again carries what it can (voices, state); a different one crossfades.
      const carry = before === plan ? carryWords(before, plan, () => true) : undefined;
      bank.load(track, plan, {}, carry ? { carry } : {});
      loaded[track] = plan;
      if (plan === sampler) {
        const ref = index % 5;
        bank.setSample(track, "sound", `sample${ref}`, audioOf(ref));
      }
      const time = (block * BLOCK) / RATE;
      [60, 64, 67].forEach((note) => bank.noteOn(track, note + (index % 12), 0.8, time));
      play(3);
      bank.allNotesOff(track, (block * BLOCK) / RATE);
      play(2);
      if (index % 7 === 6) {
        // Emptied now and then, its samples let go, so the next load starts from nothing.
        if (plan === sampler) bank.setSample(track, "sound", "", null);
        bank.unload(track);
        loaded[track] = null;
      }
    };

    // Every combination three times, to reach the high-water mark: the plans on each track (12 rounds),
    // the five sample lengths and the emptying every seventh round only line up again after all three,
    // 420 rounds, and the heap's layout depends on the order it all came in too. Fewer wasn't always
    // enough: it peaked at round 245, then after INST-56.1's restrike at round 521, then after INST-9.2's
    // choke group (a voice four bytes bigger) at round 1121, and stayed flat from there to round 6000.
    const warmUp = PLANS.length * 2 * 5 * 7 * 3;
    Array.from({ length: warmUp }, (_, index) => round(index));
    const warm = bank.engine.memory.buffer.byteLength;
    Array.from({ length: 600 }, (_, index) => round(warmUp + index));
    expect(bank.engine.memory.buffer.byteLength).toBe(warm);
  });
});
