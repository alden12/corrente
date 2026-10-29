/**
 * A whole chain's graph (INST-44.2): a track's or a patch's MIDI devices, instrument and effects, each
 * device's own graph (graph.ts, midi/graph.ts) as a group, joined in the order notes and sound pass
 * through them. DOM-free; `DeviceGraphView` lays the groups out and draws them.
 *
 * Each group names its **entry** (where the chain comes in: a MIDI device's notes in, an instrument's
 * voices, an effect's input) and its **exit** (its output), which the chain's links join.
 */
import { engineMidiDefinition } from "../midi/engine";
import { midiDeviceSchema } from "../midi/device/catalog";
import { midiDeviceGraph } from "../midi/graph";
import { engineDevice } from "./engineDevices";
import { deviceGraph, type DeviceGraph } from "./graph";

export type DeviceKind = "midi" | "instrument" | "effect";

/** One device in a chain, as the caller names it. */
export interface ChainDevice {
  kind: DeviceKind;
  type: string;
  label: string;
  bypassed?: boolean;
}

/** A device and its graph; none for a device with no definition to draw (one not on the engine). */
export interface ChainGroup extends ChainDevice {
  graph?: DeviceGraph;
  entry?: string;
  exit?: string;
}

/** Where the chain comes into each kind of device: the node it arrives at. */
const ENTRIES: Record<DeviceKind, string> = {
  midi: "signal:notes",
  instrument: "signal:voice",
  effect: "signal:input",
};

/** A device's graph by its kind and type, or none if the engine has no definition for it. */
export function graphOfDevice(kind: DeviceKind, type: string): DeviceGraph | undefined {
  if (kind === "midi") {
    const definition = engineMidiDefinition(type);
    return definition && midiDeviceGraph(definition, midiDeviceSchema(type));
  }
  const spec = engineDevice(type);
  return spec && deviceGraph(spec.authored, spec.schema);
}

/** Whether a device has a graph to show. */
export const hasGraph = (kind: DeviceKind, type: string): boolean =>
  kind === "midi" ? !!engineMidiDefinition(type) : !!engineDevice(type);

/** Each device in `devices` as a group, with the nodes the chain enters and leaves it by, where it has them. */
export const chainGroups = (devices: readonly ChainDevice[]): ChainGroup[] =>
  devices.map((device) => {
    const graph = graphOfDevice(device.kind, device.type);
    const has = (id: string) => graph?.nodes.some((node) => node.id === id);
    return {
      ...device,
      ...(graph ? { graph } : {}),
      ...(has(ENTRIES[device.kind]) ? { entry: ENTRIES[device.kind] } : {}),
      ...(has("output:out") ? { exit: "output:out" } : {}),
    };
  });
