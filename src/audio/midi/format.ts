/**
 * The MIDI device format (INST-11.1): a MIDI device as data, a small graph
 * of event nodes the engine plays (engine/src/midi), compiled by compile.ts. DOM-free, so the app and
 * both MCP servers share it.
 *
 *   {
 *     "format": 1,
 *     "nodes": {
 *       "keys": { "node": "input" },
 *       "clock": { "node": "clock", "inputs": { "sync": "keys", "beats": { "param": "rate" } } },
 *       "arp": { "node": "pick", "inputs": { "notes": "keys", "ticks": "clock", "direction": { "param": "pattern" } } }
 *     },
 *     "output": "arp"
 *   }
 *
 * - **Nodes** are kinds from the palette (NODE_SPECS), named like an instrument's nodes.
 * - **Each input** is a port or a field, by the node's spec. A port takes the node (or nodes, merged)
 *   it reads, which must output what the port carries: notes, or a clock's ticks. A field takes a
 *   value: a number, a param binding (as an instrument's, `{ "param": "rate" }`), or
 *   `{ "random": [min, max] }`, drawn the same way every time; a choice an option's name; a switch
 *   true or false; a length in beats a note division (`"1/8"`) or a number of beats. A field left out
 *   keeps its spec's default.
 * - **`output`** is the node whose notes the device plays on: to the next device, or the voices.
 *
 * The palette is small on purpose: a device can't invent a node, so whatever it says, the engine can
 * run cheaply. Nodes come in as the stress test in the design doc calls for them.
 */
import { z } from "zod";
import { NODE_NAME, paramBindingSchema } from "../definitions/format";

/** The format's version. A change that old devices can't be read under bumps it, with an upcaster. */
export const MIDI_FORMAT = 1;

/** What a port reads and a node outputs. */
export type Wire = "notes" | "ticks";

/** A random number from `min` to `max`, drawn the same way every time for the same step or note. */
export const randomSchema = z.strictObject({ random: z.tuple([z.number().finite(), z.number().finite()]) });

export const numberFieldSchema = z.union([z.number().finite(), paramBindingSchema, randomSchema]);

/** One copy a stack makes: moved by `interval` semitones, its velocity scaled, and on or off. */
export const copySchema = z.strictObject({
  interval: numberFieldSchema,
  velocity: numberFieldSchema.optional(),
  on: z.union([z.boolean(), paramBindingSchema]).optional(),
});

/** The most copies a stack makes (the engine's MAX_COPIES). */
export const MAX_COPIES = 8;

/** A field of a node, by its type: what it accepts, and what it is if left out. */
export type FieldSpec =
  | { name: string; type: "number"; min: number; max: number; default: number }
  | { name: string; type: "choice"; options: readonly string[]; default: string }
  | { name: string; type: "switch"; default: boolean }
  | { name: string; type: "beats"; default: string }
  | { name: string; type: "copies" };

export interface PortSpec {
  name: string;
  wire: Wire;
  /** A port that may be left unwired. */
  optional?: true;
}

export interface NodeSpec {
  name: string;
  /** What the node is for, for an agent reading the palette. */
  description: string;
  ports: readonly PortSpec[];
  fields: readonly FieldSpec[];
  output: Wire;
}

/** The directions a pick walks what's held. */
export const PICK_DIRECTIONS = ["up", "down", "updown", "random", "played"] as const;

/**
 * The palette, in the order the engine numbers the kinds (engine/src/midi/nodes.rs's SPECS): each
 * kind's ports and fields, in the order the words carry them. The two change together.
 */
export const NODE_SPECS: readonly NodeSpec[] = [
  { name: "input", description: "the notes the device is given", ports: [], fields: [], output: "notes" },
  {
    name: "clock",
    description: "ticks every `beats`, locked to the transport; stopped, it free-runs from the first note on `sync`",
    ports: [{ name: "sync", wire: "notes", optional: true }],
    fields: [{ name: "beats", type: "beats", default: "1/8" }],
    output: "ticks",
  },
  {
    name: "pick",
    description:
      "holds the notes it's given and plays one on each tick, for `gate` of a step: walking `direction` over `octaves` octaves",
    ports: [
      { name: "notes", wire: "notes" },
      { name: "ticks", wire: "ticks" },
    ],
    fields: [
      { name: "direction", type: "choice", options: PICK_DIRECTIONS, default: "up" },
      { name: "octaves", type: "number", min: 1, max: 8, default: 1 },
      { name: "gate", type: "number", min: 0, max: 1, default: 0.5 },
    ],
    output: "notes",
  },
  {
    name: "stack",
    description: "plays copies of each note, each moved by its interval, its velocity scaled, and on or off",
    ports: [{ name: "notes", wire: "notes" }],
    fields: [{ name: "copies", type: "copies" }],
    output: "notes",
  },
  {
    name: "transpose",
    description: "moves each note by `semitones`",
    ports: [{ name: "notes", wire: "notes" }],
    fields: [{ name: "semitones", type: "number", min: -48, max: 48, default: 0 }],
    output: "notes",
  },
  {
    name: "velocity",
    description: "scales each note's velocity by `scale`",
    ports: [{ name: "notes", wire: "notes" }],
    fields: [{ name: "scale", type: "number", min: 0, max: 4, default: 1 }],
    output: "notes",
  },
];

/** A node spec by name. */
export const nodeSpecNamed = (name: string): NodeSpec | undefined => NODE_SPECS.find((spec) => spec.name === name);

export const midiNodeSchema = z.strictObject({
  node: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).optional(),
});

/** The format's shape; compile.ts checks each node's inputs against its spec. */
export const midiDefinitionSchema = z.strictObject({
  format: z.literal(MIDI_FORMAT),
  nodes: z.record(z.string().regex(NODE_NAME, "node names are a letter then letters, digits and _"), midiNodeSchema),
  output: z.string().min(1),
});

export type MidiDefinition = z.infer<typeof midiDefinitionSchema>;
export type MidiNode = z.infer<typeof midiNodeSchema>;
export type NumberField = z.infer<typeof numberFieldSchema>;
export type Copy = z.infer<typeof copySchema>;
