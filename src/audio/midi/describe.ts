/**
 * The MIDI device format as data an agent reads before writing one (INST-11.3): read off the palette
 * (NODE_SPECS), so a node added there is described here too. DOM-free, for both MCP servers.
 */
import { MIDI_FORMAT, NODE_SPECS, type FieldSpec } from "./format";

/** What a field takes, in a few words. */
const FIELD_TAKES: { [Type in FieldSpec["type"]]: (field: Extract<FieldSpec, { type: Type }>) => string } = {
  number: (field) =>
    `a number ${field.min} to ${field.max} (default ${field.default}), a param, { random: [min, max] }, or read off each note`,
  choice: (field) =>
    `one of ${field.options.join(", ")} (default ${field.default}), or an enum param with those options`,
  switch: (field) => `true or false (default ${field.default}), or a boolean param`,
  beats: (field) =>
    `a note division like "1/16" or "1/8T", a number of beats (default "${field.default}"), a param (an enum of divisions, or a number in beats), or read off each note`,
  copies: () => "a list of { interval, velocity?, on? }, each a number field (on: true, false or a boolean param)",
};

const takes = (field: FieldSpec): string => (FIELD_TAKES[field.type] as (field: FieldSpec) => string)(field);

export const midiFormatDoc = () => ({
  midiDevice:
    "A custom MIDI device is { label?, color?, schema, definition }: it changes the notes a track plays before its " +
    "instrument hears them. `schema` is its params, as an instrument's. `definition` is " +
    `{ "format": ${MIDI_FORMAT}, "nodes": { name: { "node": kind, "inputs": {...} } }, "output": name }: a small graph ` +
    "of event nodes, each after what it reads. `inputs` names each port's source (a node's name, or a list of names " +
    'merged) and sets each field. A field is a value, a param binding { "param": id }, { "random": [min, max] } ' +
    '(drawn the same way every time), or read off each note: { "per": "index" | "pitch" | "velocity", "times"?: ' +
    'number or param, "plus"?: number or param }. A note\'s index is its place among notes made together: a ' +
    "stack's copies, a pick's place in what's held, or a chord `order` numbered. Build devices from small nodes: " +
    "a strum is order then a delay by index; an echo a stack then a delay by index, fading by a velocity by index. " +
    "Wires carry notes or a clock's ticks; a port takes only its own kind. `output` is " +
    "the node whose notes the device plays. Every problem comes back at once when it's checked.",
  midiNodes: Object.fromEntries(
    NODE_SPECS.map((spec) => [
      spec.name,
      {
        does: spec.description,
        outputs: spec.output,
        ports: Object.fromEntries(
          spec.ports.map((port) => [port.name, `${port.wire}${port.optional ? " (optional)" : ""}`]),
        ),
        fields: Object.fromEntries(spec.fields.map((field) => [field.name, takes(field)])),
      },
    ]),
  ),
  midiExample: {
    label: "Octave arp",
    schema: [{ id: "rate", label: "Rate", kind: "enum", options: ["1/8", "1/16"], default: "1/16" }],
    definition: {
      format: MIDI_FORMAT,
      nodes: {
        keys: { node: "input" },
        clock: { node: "clock", inputs: { sync: "keys", beats: { param: "rate" } } },
        arp: { node: "pick", inputs: { notes: "keys", ticks: "clock", direction: "updown", octaves: 2 } },
      },
      output: "arp",
    },
  },
});
