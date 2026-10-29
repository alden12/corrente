/**
 * The MIDI devices the engine plays (INST-11.1, INST-11.2), by type: each one's definition in the MIDI
 * format, reading the same params as the TypeScript device it replaces, so saved projects play the
 * same. A track whose instrument is on the engine plays its devices there, ahead of its voices.
 * DOM-free, for the offline renderer too.
 */
import { compileMidiDevice, type ChainDevice, type MidiDevicePlan } from "../compile";
import type { MidiDefinition } from "../format";
import { midiDeviceSchema } from "../device/catalog";
import { engineValueOf } from "../../definitions/values";
import type { ParamStore } from "../../params/store";
import { octavatorDefinition } from "./octavator";
import { arpeggiatorDefinition } from "./arpeggiator";
import { euclideanDefinition } from "./euclidean";

/** The built-ins, and each open project's own devices (INST-11.3) as they register. */
const DEFINITIONS = new Map<string, MidiDefinition>([
  ["octavator", octavatorDefinition],
  ["arpeggiator", arpeggiatorDefinition],
  ["euclidean", euclideanDefinition],
]);

/** A device on a track, as the project holds it. */
export interface MidiDeviceSource {
  id: string;
  type: string;
  bypassed: boolean;
  params: ParamStore;
}

const plans = new Map<string, MidiDevicePlan>();

/** Play a project's own device by its definition, replacing any before it (checked: parseCustomMidiDevice). */
export const registerEngineMidiDevice = (type: string, definition: MidiDefinition): void => {
  DEFINITIONS.set(type, definition);
  plans.delete(type);
};

export const unregisterEngineMidiDevice = (type: string): void => {
  DEFINITIONS.delete(type);
  plans.delete(type);
};

/**
 * A device type's plan, compiled once against its schema; undefined if the engine doesn't play it.
 * A device edited gets a new plan, so whoever holds the old one can tell.
 */
export const engineMidiPlan = (type: string): MidiDevicePlan | undefined => {
  const definition = DEFINITIONS.get(type);
  if (!definition) return undefined;
  const plan = plans.get(type) ?? compileMidiDevice(definition, midiDeviceSchema(type));
  plans.set(type, plan);
  return plan;
};

/** Whether the engine plays every one of a track's devices (none counts). */
export const playsInEngine = (devices: readonly MidiDeviceSource[]): boolean =>
  devices.every((device) => engineMidiPlan(device.type) !== undefined);

/** A param's value as the engine reads it, from the device's store. */
export const engineParamValue = (store: ParamStore, param: string): number =>
  engineValueOf(store.spec(param), store.get(param));

/** A track's devices as chainWords takes them, each param at its value now. Call after playsInEngine. */
export const chainDevicesOf = (devices: readonly MidiDeviceSource[]): ChainDevice[] =>
  devices.map((device) => {
    const plan = engineMidiPlan(device.type)!;
    return {
      plan,
      values: Object.fromEntries(plan.params.map((param) => [param, engineParamValue(device.params, param)])),
      bypassed: device.bypassed,
    };
  });
