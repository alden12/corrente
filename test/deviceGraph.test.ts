import { describe, expect, it } from "vitest";
import { engineDevice } from "../src/audio/definitions/engineDevices";
import { deviceGraph } from "../src/audio/definitions/graph";
import { ENGINE_EFFECTS } from "../src/audio/effects/engine";
import { ENGINE_INSTRUMENTS } from "../src/audio/instruments/engine";

/** A device's definition as boxes and wires (INST-44), read as written. */

const graphOf = (type: string) => {
  const spec = engineDevice(type)!;
  return deviceGraph(spec.authored, spec.schema);
};
const node = (graph: ReturnType<typeof graphOf>, id: string) => graph.nodes.find((each) => each.id === id)!;

describe("a device's graph", () => {
  it("draws Auto-Pan's blocks, its params, its signals and output", () => {
    const graph = graphOf("auto-pan");
    expect(graph.nodes.map((each) => each.id).toSorted()).toEqual(
      [
        "node:free",
        "node:synced",
        "node:wave",
        "node:level",
        "node:panned",
        "signal:host",
        "signal:input",
        "output:out",
        ...graph.nodes.filter((each) => each.kind === "param").map((each) => each.id),
      ].toSorted(),
    );
    // A number is written on the input; a param is wired in, its wire saying what's done to it.
    expect(node(graph, "node:wave").inputs).toContainEqual({ name: "c", value: "0" });
    expect(node(graph, "param:rate")).toMatchObject({ kind: "param", title: "Rate", subtitle: "0.05 to 10 Hz" });
    expect(graph.edges).toContainEqual({ from: "param:rate", fromPort: "value", to: "node:free", toPort: "rate" });
    expect(graph.edges).toContainEqual(expect.objectContaining({ to: "node:level", toPort: "b", label: "× -0.5 + 1" }));
    // A stereo node stays one box; a wire per channel says which.
    expect(node(graph, "node:level").stereo).toBe(true);
    expect(
      graph.edges.filter((edge) => edge.to === "node:level" && edge.toPort === "a").map((edge) => edge.label),
    ).toEqual(["L × Depth × 0.5", "R × Depth × -0.5"]);
    // The output takes the stereo node on both channels.
    expect(graph.edges.filter((edge) => edge.to === "output:out").map((edge) => edge.toPort)).toEqual([
      "left",
      "right",
    ]);
  });

  it("marks an instrument's voice blocks, and sums its voices to the output when it doesn't say", () => {
    const graph = graphOf("subtractive");
    expect(graph.nodes.some((each) => each.voice)).toBe(true);
    expect(node(graph, "signal:voice").outputs.map((port) => port.name)).toContain("frequency");
  });

  it("draws every built-in, with every wire between boxes it drew", () => {
    [...ENGINE_INSTRUMENTS, ...ENGINE_EFFECTS].forEach((builtin) => {
      const graph = graphOf(builtin.type);
      const ids = new Set(graph.nodes.map((each) => each.id));
      expect(graph.nodes.length, builtin.type).toBeGreaterThan(0);
      graph.edges.forEach((edge) => {
        expect(ids.has(edge.from) && ids.has(edge.to), `${builtin.type}: ${edge.from} -> ${edge.to}`).toBe(true);
      });
    });
  });
});
