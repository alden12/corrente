/**
 * A MIDI device's definition (format.ts) as a graph to draw (INST-44.2), in the same boxes and wires as
 * an instrument's or an effect's (definitions/graph.ts), so a whole chain reads as one drawing. DOM-free.
 *
 * Its `input` nodes are one "Notes in" signal, its `output` a "Notes out" box. Each event node is a
 * box: its ports wired from the nodes they read, its fields written on their rows (a number, a choice,
 * a random range, what's read off each note) and any param in them wired in as a tag. A stack's copies
 * get a row each.
 */
import {
  bindingText,
  paramText,
  round,
  wireParam,
  type DeviceGraph,
  type GraphBuilder,
  type GraphPort,
} from "../definitions/graph";
import type { ParamBinding } from "../definitions/format";
import type { ParamSchema } from "../params/types";
import { nodeSpecNamed, type MidiDefinition } from "./format";

/** The notes the device is given, and what it plays on. */
const NOTES_IN = "signal:notes";
const NOTES_OUT = "output:out";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBinding = (value: unknown): value is ParamBinding => isObject(value) && typeof value.param === "string";

interface Builder extends GraphBuilder {
  definition: MidiDefinition;
}

/** Where a node reference's events come from: the notes in, or a node's output. */
const sourceOf = (builder: Builder, name: string): { from: string; fromPort: string } | undefined => {
  const node = builder.definition.nodes[name];
  if (!node) return undefined;
  if (node.node === "input") return { from: NOTES_IN, fromPort: "notes" };
  return { from: `node:${name}`, fromPort: nodeSpecNamed(node.node)?.output ?? "notes" };
};

/** A number, a param, or a param read with a scale, in words: a param by its label. */
const amountText = (builder: Builder, value: unknown): string | undefined =>
  typeof value === "number" ? round(value) : isBinding(value) ? paramText(builder, value) : undefined;

/**
 * A field's value in words, wiring any param in it into `to`'s `toPort`. A bare param is wired and
 * written as nothing; one inside something (a random range, a per-note amount) is named in the words.
 */
const fieldText = (builder: Builder, value: unknown, to: string, toPort: string): string | undefined => {
  if (typeof value === "number") return round(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "on" : "off";
  if (!isObject(value)) return undefined;
  if (isBinding(value)) {
    wireParam(builder, value.param, to, toPort, bindingText(value) || undefined);
    return undefined;
  }
  if (Array.isArray(value.random)) return `random ${value.random.map((each) => round(Number(each))).join(" to ")}`;
  if (typeof value.per === "string") {
    [value.times, value.plus]
      .filter(isBinding)
      .forEach((binding) => wireParam(builder, binding.param, to, toPort, `per ${value.per}`));
    const times = amountText(builder, value.times);
    const plus = amountText(builder, value.plus);
    return [`per ${value.per}`, times && `× ${times}`, plus && `+ ${plus}`].filter(Boolean).join(" ");
  }
  return undefined;
};

/** A stack's copy in words, its params wired into its row: its interval, its velocity, whether it's on. */
const copyText = (builder: Builder, copy: unknown, to: string, toPort: string): string | undefined => {
  if (!isObject(copy)) return undefined;
  const interval = fieldText(builder, copy.interval, to, toPort);
  const velocity = copy.velocity === undefined ? undefined : fieldText(builder, copy.velocity, to, toPort);
  const on = copy.on === undefined ? undefined : fieldText(builder, copy.on, to, toPort);
  return [
    interval !== undefined && `${interval.startsWith("-") ? "" : "+"}${interval} st`,
    velocity !== undefined && `vel ${velocity}`,
    on !== undefined && on,
  ]
    .filter(Boolean)
    .join(", ");
};

/** `definition` as boxes and wires, its params named from `params`. */
export function midiDeviceGraph(definition: MidiDefinition, params: ParamSchema): DeviceGraph {
  const builder: Builder = { nodes: new Map(), edges: [], definition, params };
  builder.nodes.set(NOTES_IN, {
    id: NOTES_IN,
    kind: "signal",
    title: "Notes in",
    inputs: [],
    outputs: [{ name: "notes" }],
  });
  Object.entries(definition.nodes)
    .filter(([, node]) => node.node !== "input")
    .forEach(([name, node]) => {
      const spec = nodeSpecNamed(node.node);
      const id = `node:${name}`;
      builder.nodes.set(id, {
        id,
        kind: "block",
        title: name,
        subtitle: node.node,
        inputs: [],
        outputs: [{ name: spec?.output ?? "notes" }],
      });
      const inputs = node.inputs ?? {};
      // Ports first, then fields, in the spec's order; a field left out keeps its default and isn't drawn.
      const ports = (spec?.ports ?? [])
        .filter((port) => inputs[port.name] !== undefined)
        .map((port): GraphPort => {
          const read = inputs[port.name];
          (Array.isArray(read) ? read : [read])
            .filter((each): each is string => typeof each === "string")
            .forEach((each) => {
              const source = sourceOf(builder, each);
              if (source) builder.edges.push({ ...source, to: id, toPort: port.name });
            });
          return { name: port.name };
        });
      const fields = (spec?.fields ?? [])
        .filter((field) => inputs[field.name] !== undefined)
        .flatMap((field): GraphPort[] => {
          const value = inputs[field.name];
          if (field.type === "copies" && Array.isArray(value)) {
            return value.map((copy, index) => {
              const row = `copy ${index + 1}`;
              const text = copyText(builder, copy, id, row);
              return text ? { name: row, value: text } : { name: row };
            });
          }
          const text = fieldText(builder, value, id, field.name);
          return text === undefined ? [{ name: field.name }] : [{ name: field.name, value: text }];
        });
      builder.nodes.get(id)!.inputs = [...ports, ...fields];
    });
  builder.nodes.set(NOTES_OUT, {
    id: NOTES_OUT,
    kind: "output",
    title: "Notes out",
    inputs: [{ name: "notes" }],
    outputs: [],
  });
  const played = sourceOf(builder, definition.output);
  if (played) builder.edges.push({ ...played, to: NOTES_OUT, toPort: "notes" });
  return { nodes: [...builder.nodes.values()], edges: builder.edges };
}
