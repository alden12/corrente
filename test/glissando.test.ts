import { describe, expect, it } from "vitest";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { compileDefinition } from "../src/audio/definitions/compile";
import { chainWords } from "../src/audio/midi/compile";
import { chainDevicesOf } from "../src/audio/midi/engine";
import { midiDeviceSchema } from "../src/audio/midi/device/catalog";
import { ParamStore } from "../src/audio/params/store";
import type { ParamValue } from "../src/audio/params/types";
import { RATE, wasm } from "./support/engine";

/**
 * The Glissando (INST-32) as a track plays it, through the real engine.wasm: a note played over a
 * held one runs to it, a Speed apart, in the key if asked; one played on its own just plays.
 */

/** Each voice plays its gate: enough for the chain to have somewhere to send its notes. */
const plan = compileDefinition({
  format: 1,
  nodes: { vca: { block: "mul", voice: true, inputs: { a: "voice.gate", b: 1 } } },
  voice: "vca",
});

/** The notes the device sends the voices for `keys` ([note, seconds] on, or off with a minus note), as [note, seconds]. */
const played = (keys: [number, number][], params: Record<string, ParamValue> = {}) => {
  const bank = new EngineBank(wasm, RATE, 1);
  bank.load(0, plan);
  const store = new ParamStore(midiDeviceSchema("glissando"));
  Object.entries(params).forEach(([id, value]) => store.set(id, value));
  bank.loadMidi(0, chainWords(chainDevicesOf([{ id: "g", type: "glissando", bypassed: false, params: store }])).words);
  keys.forEach(([note, time]) => (note > 0 ? bank.noteOn(0, note, 1, time) : bank.noteOff(0, -note, time)));
  return Array.from({ length: Math.ceil(RATE / BLOCK) }, (_, block) => {
    bank.process((block * BLOCK) / RATE);
    return bank
      .midiPlayed(0)
      .filter((event) => event.velocity > 0)
      .map((event) => [event.note, (block * BLOCK + event.offset) / RATE] as const);
  }).flat();
};

/** A 64th at 120: an eighth of a beat of half a second. */
const STEP = 0.5 / 16;

describe("Glissando", () => {
  it("runs up to a note played over a held one, a Speed apart", () => {
    const notes = played([
      [60, 0],
      [64, 0.1],
    ]);
    expect(notes.map(([note]) => note)).toEqual([60, 61, 62, 63, 64]);
    const starts = notes.slice(1).map(([, time]) => time - 0.1);
    starts.forEach((start, index) => expect(start).toBeCloseTo(index * STEP, 3));
  });

  it("runs through the song's key with Scale in key, and leaves a detached note alone on legato", () => {
    const inKey = played(
      [
        [60, 0],
        [67, 0.1],
      ],
      { scale: "in key" },
    );
    expect(inKey.map(([note]) => note)).toEqual([60, 62, 64, 65, 67]);
    const detached = [
      [60, 0],
      [-60, 0.05],
      [64, 0.1],
    ] as [number, number][];
    expect(played(detached, { when: "legato" }).map(([note]) => note)).toEqual([60, 64]);
    // Always, to start with, it runs to every note.
    expect(played(detached).map(([note]) => note)).toEqual([60, 61, 62, 63, 64]);
  });
});
