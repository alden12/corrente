/**
 * The MIDI-device catalog: pure data (labels + parameter schemas), no audio/DOM.
 * Mirrors effects/catalog.ts so the ProjectStore and the Node MCP server can consume
 * device schemas without Web Audio types. The runtime interpreter (GraphMidiDevice)
 * and its factory live in registry.ts.
 *
 * Devices are registered, not hardcoded: built-ins self-register below and
 * `registerMidiDevice` is the extension point. Each device's note transform lives with
 * its def in devices/ (registry.ts wires the factory); only the schema is data here.
 */
import type { ParamSchema } from "../../params/types";
import { RATE_OPTIONS } from "./devices/rate";
import type { Tag } from "../../tags";
import type { DeviceColor } from "../../deviceColors";

export const octavatorSchema: ParamSchema = [
  { id: "octaveUp", label: "Octave up", kind: "boolean", default: true },
  { id: "octaveDown", label: "Octave down", kind: "boolean", default: false },
  { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear" },
] as const;

export const arpeggiatorSchema: ParamSchema = [
  { id: "rate", label: "Rate", kind: "enum", options: RATE_OPTIONS, default: "1/8" },
  { id: "pattern", label: "Pattern", kind: "enum", options: ["up", "down", "updown", "random"], default: "up" },
  { id: "octaves", label: "Octaves", kind: "number", min: 1, max: 4, default: 1, step: 1, taper: "linear" },
  { id: "gate", label: "Gate", kind: "number", min: 0.05, max: 1, default: 0.5, taper: "linear" },
] as const;

/**
 * Euclidean sequencer params, following the Torso T-1's rhythm section: steps/pulses/rotate
 * shape the pattern, repeats ratchets a hit, accent leans on the cycle's first hit, and voicing
 * says whether an onset plays the whole held chord or walks it like an arp.
 */
export const euclideanSchema: ParamSchema = [
  { id: "rate", label: "Rate", kind: "enum", options: RATE_OPTIONS, default: "1/16" },
  {
    id: "voicing",
    label: "Voicing",
    kind: "enum",
    options: ["chord", "up", "down", "updown", "random"],
    default: "chord",
  },
  { id: "steps", label: "Steps", kind: "number", min: 1, max: 32, default: 16, step: 1, taper: "linear" },
  { id: "pulses", label: "Pulses", kind: "number", min: 0, max: 32, default: 4, step: 1, taper: "linear" },
  { id: "rotate", label: "Rotate", kind: "number", min: 0, max: 31, default: 0, step: 1, taper: "linear" },
  { id: "repeats", label: "Repeats", kind: "number", min: 1, max: 8, default: 1, step: 1, taper: "linear" },
  { id: "gate", label: "Gate", kind: "number", min: 0.05, max: 1, default: 0.5, taper: "linear" },
  { id: "accent", label: "Accent", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
] as const;

/** Strum (INST-35): a chord's notes one after another, up, down or alternating, tilted in velocity. */
export const strumSchema: ParamSchema = [
  { id: "direction", label: "Direction", kind: "enum", options: ["up", "down", "alternate"], default: "up" },
  { id: "spread", label: "Spread", kind: "number", min: 0, max: 0.25, default: 0.0625, taper: "linear", unit: "beats" },
  { id: "tilt", label: "Tilt", kind: "number", min: -0.3, max: 0.3, default: -0.1, taper: "linear" },
] as const;

/** Scale quantiser (DAW-12): every note into the song's key, snapping to its side. */
export const scaleQuantiserSchema: ParamSchema = [
  { id: "snap", label: "Snap", kind: "enum", options: ["nearest", "down", "up"], default: "nearest" },
] as const;

/** Harmoniser (DAW-12): one or two notes above each, an interval apart in the song's key. */
export const harmoniserSchema: ParamSchema = [
  { id: "interval", label: "Interval", kind: "enum", options: ["3rd", "4th", "5th", "6th"], default: "3rd" },
  { id: "voices", label: "Voices", kind: "enum", options: ["1", "2"], default: "1" },
  { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8, taper: "linear" },
  { id: "low", label: "Lowest", kind: "number", min: 24, max: 96, default: 48, step: 1, taper: "linear" },
  { id: "high", label: "Highest", kind: "number", min: 36, max: 108, default: 84, step: 1, taper: "linear" },
] as const;

export interface MidiDeviceInfo {
  /** Stable id used on the wire, in persistence, and to address the factory. */
  type: string;
  label: string;
  schema: ParamSchema;
  /** Tags from the vocabulary (`tags.ts`), for Explore's chips and search. */
  tags?: readonly Tag[];
  /** Its colour (DAW-61.2); read it through `deviceColor`, which fills in one that is missing. */
  color?: DeviceColor;
  /** A project's own device (INST-11.3), registered while that project is open. */
  custom?: boolean;
}

/** The MIDI-device data registry (insertion order = palette / add-button order). */
const REGISTRY = new Map<string, MidiDeviceInfo>();

/** Register a device's data (label + schema). The runtime factory is registered
 *  separately in registry.ts, so this stays DOM-free for the server. */
export function registerMidiDevice(info: MidiDeviceInfo): void {
  REGISTRY.set(info.type, info);
}

/** Take a device out of the registry: a project's own device, as the project closes or drops it. */
export function unregisterMidiDevice(type: string): void {
  REGISTRY.delete(type);
}

/** Every registered device, in registration order (iterate this, never hardcode). */
export function midiDeviceInfos(): MidiDeviceInfo[] {
  return [...REGISTRY.values()];
}

/** Whether a device type is registered. */
export function hasMidiDevice(type: string): boolean {
  return REGISTRY.has(type);
}

export const DEFAULT_MIDI_DEVICE = "octavator";

export function midiDeviceCatalogEntry(type: string): MidiDeviceInfo {
  return REGISTRY.get(type) ?? REGISTRY.get(DEFAULT_MIDI_DEVICE)!;
}

export function midiDeviceSchema(type: string): ParamSchema {
  return midiDeviceCatalogEntry(type).schema;
}

// --- built-in MIDI devices (self-registered) ------------------------------
registerMidiDevice({
  type: "octavator",
  label: "Octavator",
  schema: octavatorSchema,
  tags: ["bass", "lead"],
  color: "pink",
});
registerMidiDevice({
  type: "arpeggiator",
  label: "Arpeggiator",
  schema: arpeggiatorSchema,
  tags: ["arp"],
  color: "violet",
});
registerMidiDevice({
  type: "euclidean",
  label: "Euclidean",
  schema: euclideanSchema,
  tags: ["rhythm", "percussion"],
  color: "amber",
});
registerMidiDevice({
  type: "strum",
  label: "Strum",
  schema: strumSchema,
  tags: ["keys", "pluck"],
  color: "orange",
});
registerMidiDevice({
  type: "scale-quantiser",
  label: "Scale Quantiser",
  schema: scaleQuantiserSchema,
  tags: ["lead", "bass"],
  color: "cyan",
});
registerMidiDevice({
  type: "harmoniser",
  label: "Harmoniser",
  schema: harmoniserSchema,
  tags: ["lead", "keys"],
  color: "indigo",
});
