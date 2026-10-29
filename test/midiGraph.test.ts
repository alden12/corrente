import { describe, expect, it } from "vitest";
import { chainGroups } from "../src/audio/definitions/chainGraph";
import { midiDeviceInfos, midiDeviceSchema } from "../src/audio/midi/device/catalog";
import { engineMidiDefinition } from "../src/audio/midi/engine";
import { midiDeviceGraph } from "../src/audio/midi/graph";

/** A MIDI device's definition as boxes and wires (INST-44.2), and a whole chain's devices as groups. */

const graphOf = (type: string) => midiDeviceGraph(engineMidiDefinition(type)!, midiDeviceSchema(type));

describe("a MIDI device's graph", () => {
  it("draws the arpeggiator from its notes in to its notes out, its params wired in", () => {
    const graph = graphOf("arpeggiator");
    expect(graph.nodes.find((node) => node.id === "node:clock")).toMatchObject({ subtitle: "clock" });
    // The input node is the notes in, which the clock syncs to.
    expect(graph.edges).toContainEqual({ from: "signal:notes", fromPort: "notes", to: "node:clock", toPort: "sync" });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: "param:rate", to: "node:clock", toPort: "beats" }),
    );
    expect(graph.edges).toContainEqual({ from: "node:gate", fromPort: "notes", to: "output:out", toPort: "notes" });
  });

  it("gives a stack's copies a row each, a param switching one wired into its row", () => {
    const graph = graphOf("arpeggiator");
    const stack = graph.nodes.find((node) => node.id === "node:octaves")!;
    expect(stack.inputs.map((port) => port.name)).toEqual(["notes", "copy 1", "copy 2", "copy 3", "copy 4"]);
    expect(stack.inputs[2]).toEqual({ name: "copy 2", value: "+12 st" });
    expect(graph.edges).toContainEqual({
      from: "param:octaves",
      fromPort: "value",
      to: "node:octaves",
      toPort: "copy 2",
      label: "mapped",
    });
  });

  it("draws every built-in, with every wire between boxes it drew", () => {
    midiDeviceInfos()
      .filter((info) => engineMidiDefinition(info.type))
      .forEach((info) => {
        const graph = graphOf(info.type);
        const ids = new Set(graph.nodes.map((node) => node.id));
        graph.edges.forEach((edge) => {
          expect(ids.has(edge.from) && ids.has(edge.to), `${info.type}: ${edge.from} -> ${edge.to}`).toBe(true);
        });
      });
  });
});

describe("a chain's graph", () => {
  it("enters and leaves each device where the chain passes through it", () => {
    const groups = chainGroups([
      { kind: "midi", type: "arpeggiator", label: "Arpeggiator" },
      { kind: "instrument", type: "subtractive", label: "Subtractive" },
      { kind: "effect", type: "auto-pan", label: "Auto-Pan" },
    ]);
    expect(groups.map(({ entry, exit }) => [entry, exit])).toEqual([
      ["signal:notes", "output:out"],
      ["signal:voice", "output:out"],
      ["signal:input", "output:out"],
    ]);
  });

  it("keeps a device it can't draw, with no graph", () => {
    expect(chainGroups([{ kind: "effect", type: "no-such-effect", label: "?" }])[0].graph).toBeUndefined();
  });
});
