import { describe, expect, it } from "vitest";
import { chainWords, compileMidiDevice, MidiDefinitionError } from "../src/audio/midi/compile";
import { MIDI_FORMAT, NODE_SPECS } from "../src/audio/midi/format";
import { octavatorDefinition } from "../src/audio/midi/engine/octavator";
import { octavatorSchema, arpeggiatorSchema } from "../src/audio/midi/device/catalog";
import type { ParamSchema } from "../src/audio/params/types";

/**
 * The MIDI device compiler (INST-11.1): devices checked against the node palette and put in an order
 * the engine runs, every problem found at once; then a track's devices as eng_midi_load's words.
 * engine/src/tests/midi.rs plays words like these.
 */

const problemsOf = (definition: unknown, params?: ParamSchema): string[] => {
  try {
    compileMidiDevice(definition, params);
  } catch (error) {
    if (error instanceof MidiDefinitionError) return error.problems;
    throw error;
  }
  return [];
};

const device = (nodes: Record<string, unknown>, output = "out") => ({ format: MIDI_FORMAT, nodes, output });

/** An arpeggiator from the palette, reading the TypeScript arpeggiator's params. */
const arpeggiator = device(
  {
    keys: { node: "input" },
    clock: { node: "clock", inputs: { sync: "keys", beats: { param: "rate" } } },
    arp: { node: "pick", inputs: { ticks: "clock", notes: "keys", direction: { param: "pattern" } } },
    out: { node: "length", inputs: { notes: "arp", scale: { param: "gate" } } },
  },
  "out",
);

describe("compileMidiDevice", () => {
  it("puts each node after what it reads, whatever order they're written in", () => {
    const plan = compileMidiDevice(arpeggiator, arpeggiatorSchema);
    expect(plan.nodes.map((node) => node.name)).toEqual(["keys", "clock", "arp", "out"]);
    expect(plan.nodes.map((node) => NODE_SPECS[node.kind].name)).toEqual(["input", "clock", "pick", "length"]);
    // The pick reads the keys (place 0) and the clock (place 1), in its ports' order: notes, then ticks.
    expect(plan.nodes[2].ports).toEqual([[0], [1]]);
    expect(plan.output).toBe(3);
    expect(plan.params).toEqual(["rate", "pattern", "gate"]);
  });

  it("reads a choice of divisions as each one's beats, and a field left out as its default", () => {
    const plan = compileMidiDevice(arpeggiator, arpeggiatorSchema);
    const rate = arpeggiatorSchema.find((param) => param.id === "rate");
    expect(rate?.kind).toBe("enum");
    expect(plan.nodes[1].fields).toEqual([
      {
        param: "rate",
        scale: 1,
        offset: 0,
        table: [
          [0, 1],
          [1, 2 / 3],
          [2, 0.5],
          [3, 1 / 3],
          [4, 0.25],
          [5, 1 / 6],
          [6, 0.125],
        ],
      },
    ]);
    // Direction left out: up, the first option.
    const plain = compileMidiDevice(
      device({
        keys: { node: "input" },
        clock: { node: "clock" },
        out: { node: "pick", inputs: { notes: "keys", ticks: "clock" } },
      }),
    );
    expect(plain.nodes[2].fields[0]).toEqual({ fixed: 0 });
  });

  it("reads a choice param by option name", () => {
    const params: ParamSchema = [
      { id: "pattern", label: "Pattern", kind: "enum", options: ["down", "up"], default: "up" },
    ];
    const plan = compileMidiDevice(
      device({
        keys: { node: "input" },
        clock: { node: "clock" },
        out: { node: "pick", inputs: { notes: "keys", ticks: "clock", direction: { param: "pattern" } } },
      }),
      params,
    );
    expect(plan.nodes.find((node) => node.name === "out")?.fields[0]).toEqual({
      param: "pattern",
      scale: 1,
      offset: 0,
      table: [
        [0, 1],
        [1, 0],
      ],
    });
  });

  it("compiles the octavator, three fields a copy", () => {
    const plan = compileMidiDevice(octavatorDefinition, octavatorSchema);
    expect(plan.nodes[1].fields).toEqual([
      { fixed: 0 },
      { fixed: 1 },
      { fixed: 1 },
      { fixed: 12 },
      { param: "level", scale: 1, offset: 0 },
      { param: "octaveUp", scale: 1, offset: 0 },
      { fixed: -12 },
      { param: "level", scale: 1, offset: 0 },
      { param: "octaveDown", scale: 1, offset: 0 },
    ]);
    expect(plan.params).toEqual(["level", "octaveUp", "octaveDown"]);
  });

  it("takes a random range as a field", () => {
    const plan = compileMidiDevice(
      device({
        keys: { node: "input" },
        out: { node: "velocity", inputs: { notes: "keys", scale: { random: [0.5, 1] } } },
      }),
    );
    expect(plan.nodes[1].fields).toEqual([{ random: [0.5, 1] }]);
  });

  it("reads a field off each note: its index, times a param, plus a number", () => {
    const params: ParamSchema = [{ id: "tilt", label: "Tilt", kind: "number", min: -1, max: 1, default: 0 }];
    const plan = compileMidiDevice(
      device({
        keys: { node: "input" },
        chord: { node: "order", inputs: { notes: "keys" } },
        out: {
          node: "velocity",
          inputs: { notes: "chord", scale: { per: "index", times: { param: "tilt" }, plus: 1 } },
        },
      }),
      params,
    );
    expect(plan.nodes[2].fields).toEqual([
      { per: "index", times: { param: "tilt", scale: 1, offset: 0 }, plus: { fixed: 1 } },
    ]);
    expect(plan.params).toEqual(["tilt"]);
    // As words: per (3), index (0), then times (value 1, the device's first param after its bypass) and plus.
    const doubles = [...new Float64Array(chainWords([{ plan, values: { tilt: 0.5 }, bypassed: false }]).words.buffer)];
    expect(doubles).toEqual(expect.arrayContaining([3, 0, 1, 1, 1, 0, 0, 0, 1]));
  });

  it("finds every problem at once, each naming where it is", () => {
    const problems = problemsOf(
      device(
        {
          keys: { node: "input" },
          wobble: { node: "lfo" },
          clock: { node: "clock", inputs: { beats: "1/7x" } },
          out: { node: "pick", inputs: { notes: "clock", ticks: "nowhere", speed: 2 } },
          loud: { node: "velocity", inputs: { notes: "keys", scale: 12 } },
          up: { node: "transpose", inputs: { notes: "keys", semitones: { param: "missing" } } },
        },
        "clock",
      ),
      [],
    );
    expect(problems).toEqual([
      expect.stringContaining('wobble: there\'s no node "lfo"'),
      "out.speed: a pick has no input speed",
      "out.notes: takes notes, and clock outputs ticks",
      "out.ticks: there's no node nowhere",
      'clock.beats: "1/7x" isn\'t a note division',
      "loud.scale: 12 is outside 0 to 4",
      "up.semitones: there's no param missing",
      "output: clock outputs ticks, and a device plays notes",
    ]);
  });

  it("refuses a port left unwired, a choice param with options it doesn't have, and nodes in a loop", () => {
    const params: ParamSchema = [
      { id: "pattern", label: "Pattern", kind: "enum", options: ["up", "sideways"], default: "up" },
    ];
    expect(
      problemsOf(
        device({
          clock: { node: "clock" },
          out: { node: "pick", inputs: { ticks: "clock", direction: { param: "pattern" } } },
        }),
        params,
      ),
    ).toEqual([
      "out.notes: wire it to the node it reads",
      "out.direction: pattern's sideways isn't one of up, down, updown, random, played, chord",
    ]);
    expect(
      problemsOf(
        device({
          a: { node: "transpose", inputs: { notes: "out" } },
          out: { node: "transpose", inputs: { notes: "a" } },
        }),
      ),
    ).toEqual(["the nodes read each other round in a loop: a MIDI device runs each after what it reads"]);
  });
});

describe("chainWords", () => {
  it("makes each device's bypass and params values of their own, and writes the words the engine reads", () => {
    const octavator = compileMidiDevice(octavatorDefinition, octavatorSchema);
    const chain = chainWords([
      { plan: octavator, values: { octaveUp: 1, octaveDown: 0, level: 0.7 }, bypassed: false },
      { plan: octavator, values: { level: 0.5 }, bypassed: true },
    ]);
    expect(chain.values).toEqual([
      { device: 0 },
      { device: 0, param: "level" },
      { device: 0, param: "octaveUp" },
      { device: 0, param: "octaveDown" },
      { device: 1 },
      { device: 1, param: "level" },
      { device: 1, param: "octaveUp" },
      { device: 1, param: "octaveDown" },
    ]);
    const doubles = [...new Float64Array(chain.words.buffer)];
    // Eight values, two devices; the first device's bypass reads value 0 with no shaping, then its
    // two nodes and its output: node 1.
    expect(doubles.slice(0, 9)).toEqual([8, 2, 1, 0, 1, 0, 0, 2, 1]);
    // The input node: kind 0, no ports, no fields. Then the stack: kind 3, one port read from node 0.
    expect(doubles.slice(9, 17)).toEqual([0, 0, 0, 3, 1, 1, 0, 9]);
    // The values at the end: bypass, level, up, down for each device (a param not given is 0).
    expect(doubles.slice(-8)).toEqual([0, 0.7, 1, 0, 1, 0.5, 0, 0]);
  });
});
