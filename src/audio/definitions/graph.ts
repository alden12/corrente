/**
 * A device's definition as a graph to draw (INST-44): its blocks as boxes, the params and signals
 * feeding them as boxes of their own, and the wires between. DOM-free; `DeviceGraph.tsx` lays it out
 * and draws it.
 *
 * It reads the definition **as written**, stereo nodes and all (stereo.ts), so a stereo effect is one
 * box marked stereo rather than a left and a right copy. A number wired into an input is written on
 * the input rather than drawn as a box; a scaled or synced input labels its wire. **Params are written
 * on the inputs they feed** too, unless asked for as boxes: a big instrument has more params than
 * blocks, and as boxes they bury the signal path.
 */
import type { ParamSchema } from "../params/types";
import { blockNamed } from "./catalogue";
import type { AuthoredDefinition, ParamBinding } from "./format";

export interface GraphPort {
  name: string;
  /** A fixed number wired into it, written beside it. */
  value?: string;
}

export interface GraphNode {
  id: string;
  kind: "block" | "param" | "signal" | "output";
  title: string;
  /** The block it runs, a param's range: a second line. */
  subtitle?: string;
  /** Runs once per voice. */
  voice?: boolean;
  /** Runs once per channel (stereo.ts). */
  stereo?: boolean;
  inputs: GraphPort[];
  outputs: GraphPort[];
}

export interface GraphEdge {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  /** What's done to the signal on the way: a scale, an offset, a tempo sync, a channel. */
  label?: string;
}

export interface DeviceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Signal families, read off a reference's first word: `voices` before `voice`, as a prefix of it. */
const SIGNALS: Record<string, string> = {
  voices: "Voices summed",
  voice: "Each voice",
  input: "Track input",
  host: "Host",
};

/** A signal's family and port, or none if the reference names a node. Bare `input` and `voices` are both channels. */
const signalOf = (reference: string): { family: string; port: string } | undefined => {
  const [head, ...rest] = reference.split(".");
  return head in SIGNALS ? { family: head, port: rest.join(".") || "stereo" } : undefined;
};

const round = (value: number) => String(Number(value.toPrecision(4)));

/** Everything a definition draws, by id: built up as inputs are read. */
interface Builder {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  definition: AuthoredDefinition;
  params: ParamSchema;
  /** Params drawn as boxes wired in, rather than written on the inputs. */
  paramBoxes: boolean;
}

const paramId = (param: string) => `param:${param}`;
const signalId = (family: string) => `signal:${family}`;

/** The param's node, made the first time something reads it. */
const paramNode = (builder: Builder, param: string): string => {
  const id = paramId(param);
  if (!builder.nodes.has(id)) {
    const spec = builder.params.find((each) => each.id === param);
    const range =
      spec?.kind === "number"
        ? `${round(spec.min)} to ${round(spec.max)}${spec.unit ? ` ${spec.unit}` : ""}`
        : spec?.kind;
    builder.nodes.set(id, {
      id,
      kind: "param",
      title: spec?.label ?? param,
      ...(range ? { subtitle: range } : {}),
      inputs: [],
      outputs: [{ name: "value" }],
    });
  }
  return id;
};

/** Where a reference comes from: a signal's family and port (made as needed), or a node and its output. */
const fromReference = (builder: Builder, reference: string): { from: string; fromPort: string } | undefined => {
  const signal = signalOf(reference);
  if (signal) {
    const id = signalId(signal.family);
    const node = builder.nodes.get(id) ?? {
      id,
      kind: "signal" as const,
      title: SIGNALS[signal.family],
      inputs: [],
      outputs: [],
    };
    if (!node.outputs.some((port) => port.name === signal.port)) node.outputs.push({ name: signal.port });
    builder.nodes.set(id, node);
    return { from: id, fromPort: signal.port };
  }
  const [name, port] = reference.split(".");
  const source = builder.definition.nodes[name];
  if (!source) return undefined;
  return { from: `node:${name}`, fromPort: port ?? blockNamed(source.block)?.outputs[0]?.name ?? "out" };
};

/** What's done to a param's value on the way in: its scale, its offset, a table it's mapped through. */
const bindingText = (binding: ParamBinding): string =>
  [
    binding.scale !== undefined && `× ${round(binding.scale)}`,
    binding.offset !== undefined && `+ ${round(binding.offset)}`,
    binding.table && "mapped",
  ]
    .filter(Boolean)
    .join(" ");

/** A param in words: its label, then anything done to it. */
const paramText = (builder: Builder, binding: ParamBinding): string =>
  [builder.params.find((spec) => spec.id === binding.param)?.label ?? binding.param, bindingText(binding)]
    .filter(Boolean)
    .join(" ");

/** A scale or offset in words: a number, or the param it reads. */
const amountText = (builder: Builder, amount: number | ParamBinding | undefined): string | undefined =>
  amount === undefined ? undefined : typeof amount === "number" ? round(amount) : paramText(builder, amount);

type Item = unknown;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Wire one input item into `to`'s `toPort`: a reference, a param, a scaled reference, a synced length,
 * or a pair per channel. Returns a number to write on the port, if the item is one.
 */
const wire = (builder: Builder, item: Item, to: string, toPort: string, channel?: string): string | undefined => {
  const withChannel = (label?: string) => [channel, label].filter(Boolean).join(" ") || undefined;
  const connect = (reference: string, label?: string) => {
    const source = fromReference(builder, reference);
    if (source)
      builder.edges.push({ ...source, to, toPort, ...(withChannel(label) ? { label: withChannel(label) } : {}) });
  };
  if (typeof item === "number") return round(item);
  if (typeof item === "string") {
    connect(item);
    return undefined;
  }
  if (Array.isArray(item)) {
    const numbers = item.flatMap((each) => wire(builder, each, to, toPort, channel) ?? []);
    return numbers.length > 0 ? numbers.join(" + ") : undefined;
  }
  if (!isObject(item)) return undefined;
  if ("left" in item && "right" in item) {
    const values = [wire(builder, item.left, to, toPort, "L"), wire(builder, item.right, to, toPort, "R")];
    return values.some(Boolean) ? values.map((value) => value ?? "·").join(" / ") : undefined;
  }
  if (typeof item.from === "string") {
    const scale = amountText(builder, item.scale as number | ParamBinding | undefined);
    const offset = amountText(builder, item.offset as number | ParamBinding | undefined);
    connect(item.from, [scale && `× ${scale}`, offset && `+ ${offset}`].filter(Boolean).join(" "));
    return undefined;
  }
  if ("beats" in item) {
    const beats = item.beats;
    if (isObject(beats) && typeof beats.param === "string") {
      const binding = beats as ParamBinding;
      if (!builder.paramBoxes) return `${paramText(builder, binding)}, synced`;
      builder.edges.push({
        from: paramNode(builder, binding.param),
        fromPort: "value",
        to,
        toPort,
        label: withChannel(`synced, as ${item.as}`),
      });
      return undefined;
    }
    return `${String(beats)} beats as ${String(item.as)}`;
  }
  if (typeof item.param === "string") {
    const binding = item as ParamBinding;
    if (!builder.paramBoxes) return paramText(builder, binding);
    const label = withChannel(bindingText(binding));
    builder.edges.push({
      from: paramNode(builder, binding.param),
      fromPort: "value",
      to,
      toPort,
      ...(label ? { label } : {}),
    });
  }
  return undefined;
};

/** The output's channels: what `voice` or `output` names, one reference for both or a left and a right. */
const outputNode = (builder: Builder, id: string, title: string, channels: string | string[] | undefined) => {
  if (channels === undefined) return;
  const [left, right] = Array.isArray(channels) ? channels : [channels, channels];
  builder.nodes.set(id, { id, kind: "output", title, inputs: [{ name: "left" }, { name: "right" }], outputs: [] });
  wire(builder, left, id, "left");
  if (right !== undefined) wire(builder, right, id, "right");
};

/** `definition` as boxes and wires, its params named from `params`. */
export function deviceGraph(
  definition: AuthoredDefinition,
  params: ParamSchema,
  { paramBoxes = false }: { paramBoxes?: boolean } = {},
): DeviceGraph {
  const builder: Builder = { nodes: new Map(), edges: [], definition, params, paramBoxes };
  Object.entries(definition.nodes).forEach(([name, node]) => {
    const spec = blockNamed(node.block);
    const id = `node:${name}`;
    // Its outputs, then its inputs in the block's own order (audio inputs, then controls), each wired.
    builder.nodes.set(id, {
      id,
      kind: "block",
      title: name,
      subtitle: node.block,
      ...(node.voice ? { voice: true } : {}),
      ...(node.stereo ? { stereo: true } : {}),
      inputs: [],
      outputs: (spec?.outputs ?? []).map((port) => ({ name: port.name })),
    });
    const order = [...(spec?.inputs ?? []), ...(spec?.controls ?? [])].map((port) => port.name);
    const wired = Object.keys(node.inputs ?? {}).toSorted(
      (first, second) => order.indexOf(first) - order.indexOf(second),
    );
    const inputs = wired.map((port) => {
      const value = wire(builder, (node.inputs as Record<string, Item>)[port], id, port);
      return value === undefined ? { name: port } : { name: port, value };
    });
    builder.nodes.get(id)!.inputs = inputs;
  });
  outputNode(builder, "output:voice", "Each voice plays", definition.voice);
  // An instrument that doesn't name its output plays its voices summed.
  const voices = Object.values(definition.nodes).some((node) => node.voice);
  outputNode(
    builder,
    "output:out",
    "Output",
    definition.output ?? (voices ? ["voices.left", "voices.right"] : undefined),
  );
  return { nodes: [...builder.nodes.values()], edges: builder.edges };
}
