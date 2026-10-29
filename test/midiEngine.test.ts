import { describe, expect, it } from "vitest";
import { EngineBank, PlanRejected } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { compileDefinition } from "../src/audio/definitions/compile";
import type { DeviceDefinition } from "../src/audio/definitions/format";
import { chainWords, compileMidiDevice } from "../src/audio/midi/compile";
import { MIDI_FORMAT } from "../src/audio/midi/format";
import { octavatorDefinition } from "../src/audio/midi/engine/octavator";
import { octavatorSchema } from "../src/audio/midi/device/catalog";
import { RATE, wasm } from "./support/engine";
import { applyTransform } from "../src/audio/midi/device/transform";
import { octavator as octavatorDevice } from "../src/audio/midi/device/devices/octavator";
import { chainDevicesOf } from "../src/audio/midi/engine";
import { midiDeviceSchema } from "../src/audio/midi/device/catalog";
import { ParamStore } from "../src/audio/params/store";

/**
 * MIDI devices in the real engine.wasm (INST-11.1): a chain loaded into a track plays its notes into
 * the track's voices, knobs and bypass move without a reload, an arpeggiator steps on the transport,
 * and none of it grows the engine's memory while it plays. engine/src/tests/midi.rs checks the nodes
 * one by one; this checks the whole path from the bank.
 */

/** Each voice plays 1 while its key is down, times its velocity: what sounds is plain to read. */
const gated: DeviceDefinition = {
  format: 1,
  voices: 8,
  nodes: { vca: { block: "mul", voice: true, inputs: { a: "voice.gate", b: 1 } } },
  voice: "vca",
};
const plan = compileDefinition(gated);
const octavator = compileMidiDevice(octavatorDefinition, octavatorSchema);
const arpeggiator = compileMidiDevice({
  format: MIDI_FORMAT,
  nodes: {
    keys: { node: "input" },
    clock: { node: "clock", inputs: { sync: "keys", beats: "1/8" } },
    arp: { node: "pick", inputs: { notes: "keys", ticks: "clock" } },
    gate: { node: "length", inputs: { notes: "arp", scale: 0.5 } },
  },
  output: "gate",
});

const bankOf = () => {
  const bank = new EngineBank(wasm, RATE, 1);
  bank.load(0, plan);
  return bank;
};

/** Render `blocks` blocks from block `from`: the left channel. */
const render = (bank: EngineBank, blocks: number, from = 0) =>
  Array.from({ length: blocks }, (_, block) => {
    bank.process(((from + block) * BLOCK) / RATE);
    return Array.from(bank.output(0, 0));
  }).flat();

describe("MIDI devices in the engine", () => {
  it("plays the octavator's copies into the voices, and moves a knob without a reload", () => {
    const bank = bankOf();
    const chain = chainWords([
      { plan: octavator, values: { octaveUp: 1, octaveDown: 0, level: 0.5 }, bypassed: false },
    ]);
    bank.loadMidi(0, chain.words);
    bank.noteOn(0, 60, 0.8, 0);
    expect(render(bank, 1)[10]).toBeCloseTo(0.8 + 0.4, 6);
    // Octave down on, before the next key.
    const down = chain.values.findIndex((value) => value.param === "octaveDown");
    bank.setMidiValue(0, down, 1, BLOCK / RATE);
    bank.noteOn(0, 64, 1, (BLOCK + 20) / RATE);
    expect(render(bank, 1, 1)[30]).toBeCloseTo(1.2 + 1 + 0.5 + 0.5, 6);
  });

  it("plays the octavator as the TypeScript one did, whatever its knobs and wherever the note", () => {
    if (octavatorDevice.transform.kind !== "tap") throw new Error("the octavator is a tap");
    const transform = octavatorDevice.transform;
    const cases = [true, false].flatMap((octaveUp) =>
      [true, false].flatMap((octaveDown) =>
        [0, 0.35, 1].flatMap((level) => [3, 60, 120].map((note) => ({ octaveUp, octaveDown, level, note }))),
      ),
    );
    cases.forEach(({ octaveUp, octaveDown, level, note }) => {
      const params = new ParamStore(midiDeviceSchema("octavator"));
      params.set("octaveUp", octaveUp);
      params.set("octaveDown", octaveDown);
      params.set("level", level);
      // Each voice sounds its velocity, so the sum is every note played, at its velocity.
      const expected = applyTransform(transform, note, 0.8, { readParam: (id) => params.get(id) }).reduce(
        (sum, played) => sum + played.velocity,
        0,
      );
      const bank = bankOf();
      bank.loadMidi(0, chainWords(chainDevicesOf([{ id: "a", type: "octavator", bypassed: false, params }])).words);
      bank.noteOn(0, note, 0.8, 0);
      expect(render(bank, 1)[10], JSON.stringify({ octaveUp, octaveDown, level, note })).toBeCloseTo(expected, 6);
    });
  });

  it("bypasses a device by its value, and takes the chain away with an empty one", () => {
    const bank = bankOf();
    const chain = chainWords([{ plan: octavator, values: { octaveUp: 1, level: 1 }, bypassed: true }]);
    bank.loadMidi(0, chain.words);
    bank.noteOn(0, 60, 1, 0);
    expect(render(bank, 1)[10]).toBeCloseTo(1, 6);
    bank.setMidiValue(0, 0, 0, BLOCK / RATE);
    bank.noteOn(0, 64, 1, (BLOCK + 20) / RATE);
    // The bypass came off: 64 and its octave up join the held 60.
    expect(render(bank, 1, 1)[30]).toBeCloseTo(3, 6);
    // No devices: the keys down start again in the voices as they are.
    bank.loadMidi(0, chainWords([]).words);
    expect(render(bank, 1, 2)[30]).toBeCloseTo(2, 6);
  });

  it("steps an arpeggiator on the transport, each note for half a step", () => {
    const bank = bankOf();
    bank.setTransport({ time: 0, beat: 0, tempo: 120, playing: true });
    bank.loadMidi(0, chainWords([{ plan: arpeggiator, values: {}, bypassed: false }]).words);
    bank.noteOn(0, 60, 1, 0);
    bank.noteOn(0, 64, 0.5, 0);
    // An eighth is 12000 samples: 60 for 6000, nothing, then 64, at the loudest held velocity as
    // the TypeScript arpeggiator played.
    const sound = render(bank, 200);
    expect(sound[100]).toBeCloseTo(1, 6);
    expect(sound[7000]).toBe(0);
    expect(sound[12100]).toBeCloseTo(1, 6);
    expect(sound[24100]).toBeCloseTo(1, 6);
  });

  it("refuses words that don't make a chain, keeping the one it has", () => {
    const bank = bankOf();
    bank.loadMidi(0, chainWords([{ plan: octavator, values: { octaveUp: 1, level: 1 }, bypassed: false }]).words);
    const broken = chainWords([]);
    expect(() => bank.loadMidi(0, broken.words.slice(0, 2))).toThrow(PlanRejected);
    bank.noteOn(0, 60, 1, 0);
    expect(render(bank, 1)[10]).toBeCloseTo(2, 6);
  });

  it("keeps the engine's memory flat while chains load and play", () => {
    const bank = bankOf();
    bank.setTransport({ time: 0, beat: 0, tempo: 120, playing: true });
    let block = 0;
    const round = (index: number) => {
      const devices = [
        { plan: arpeggiator, values: {}, bypassed: false },
        { plan: octavator, values: { octaveUp: 1, octaveDown: index % 2, level: 0.5 }, bypassed: false },
      ];
      bank.loadMidi(0, chainWords(devices.slice(index % 2)).words);
      [60, 64, 67].forEach((note) => bank.noteOn(0, note + (index % 12), 0.8, (block * BLOCK) / RATE));
      render(bank, 40, block);
      block += 40;
      bank.allNotesOff(0, (block * BLOCK) / RATE);
      render(bank, 4, block);
      block += 4;
    };
    // The allocator settles in over the first couple of hundred loads (one more 64 KB page, measured
    // at about 250, then flat to 1000), so warm up past that before calling it flat.
    Array.from({ length: 300 }, (_, index) => round(index));
    const warm = bank.engine.memory.buffer.byteLength;
    Array.from({ length: 200 }, (_, index) => round(300 + index));
    expect(bank.engine.memory.buffer.byteLength).toBe(warm);
  });
});
