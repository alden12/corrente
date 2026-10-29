import { describe, expect, it } from "vitest";
import { EngineMidiChain } from "../src/audio/bank/midiChain";
import { chainWords } from "../src/audio/midi/compile";
import { chainDevicesOf, playsInEngine, type MidiDeviceSource } from "../src/audio/midi/engine";
import { midiDeviceSchema } from "../src/audio/midi/device/catalog";
import { ParamStore } from "../src/audio/params/store";

/**
 * A track's MIDI devices kept in step with the engine (INST-11.1): what an EngineInstrument sends its
 * slot as the project changes. A new set of devices loads the chain; a knob or a bypass moves one
 * value, so held notes play on.
 */

const octavator = (id: string, bypassed = false): MidiDeviceSource => ({
  id,
  type: "octavator",
  bypassed,
  params: new ParamStore(midiDeviceSchema("octavator")),
});

const chainOf = () => {
  const sent: { type: string; value?: number; raw?: number; words?: Int32Array }[] = [];
  const chain = new EngineMidiChain(
    (message) => sent.push(message),
    () => 0,
  );
  return { chain, sent, taken: () => sent.splice(0) };
};

describe("EngineMidiChain", () => {
  it("sends nothing for a track with no devices", () => {
    const { chain, sent } = chainOf();
    chain.set([]);
    expect(sent).toEqual([]);
  });

  it("loads the chain the devices make, at their values", () => {
    const { chain, taken } = chainOf();
    const device = octavator("a");
    device.params.set("level", 0.4);
    chain.set([device]);
    const [load] = taken();
    expect(load).toEqual({ type: "midi", words: chainWords(chainDevicesOf([device])).words });
  });

  it("moves a knob's value and a bypass's alone, without loading again", () => {
    const { chain, taken } = chainOf();
    const devices = [octavator("a"), octavator("b")];
    chain.set(devices);
    taken();
    // Values: a's bypass, level, up, down (0 to 3), then b's (4 to 7).
    devices[1].params.set("octaveDown", true);
    expect(taken()).toEqual([{ type: "midiValue", value: 7, raw: 1, time: 0 }]);
    chain.set([devices[0], { ...devices[1], bypassed: true }]);
    expect(taken()).toEqual([{ type: "midiValue", value: 4, raw: 1, time: 0 }]);
    // Nothing changed: nothing sent.
    chain.set([devices[0], { ...devices[1], bypassed: true }]);
    expect(taken()).toEqual([]);
  });

  it("loads again when the devices change, and stops following the ones that went", () => {
    const { chain, taken } = chainOf();
    const [first, second] = [octavator("a"), octavator("b")];
    chain.set([first, second]);
    taken();
    chain.set([second, first]);
    expect(taken()[0]).toEqual({ type: "midi", words: chainWords(chainDevicesOf([second, first])).words });
    chain.set([second]);
    taken();
    first.params.set("level", 0.1);
    expect(taken()).toEqual([]);
    chain.set([]);
    expect(taken()).toEqual([{ type: "midi", words: chainWords([]).words }]);
  });

  it("plays in the engine only when every device on the track has an engine definition", () => {
    const unknown: MidiDeviceSource = { ...octavator("c"), type: "nothing-like-it" };
    expect(playsInEngine([])).toBe(true);
    expect(playsInEngine([octavator("a"), { ...octavator("b"), type: "arpeggiator" }])).toBe(true);
    expect(playsInEngine([octavator("a"), unknown])).toBe(false);
  });
});
