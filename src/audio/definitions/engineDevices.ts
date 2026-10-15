/**
 * The devices that run on the new engine, by type (INST-36.7): their definitions and param schemas,
 * so a track's chain can compose its engine devices into one plan (chain.ts). Stereo nodes are made
 * plain as a device registers (stereo.ts), so chains only ever see plain ones. DOM-free.
 *
 * Every built-in is written in this format (INST-36.8, INST-42) and registered here as the module
 * loads; custom devices register and unregister as their project loads and edits them.
 */
import type { ParamSchema } from "../params/types";
import type { AuthoredDefinition, DeviceDefinition } from "./format";
import { ENGINE_EFFECTS } from "../effects/engine";
import { ENGINE_INSTRUMENTS } from "../instruments/engine";
import { plainDefinition } from "./stereo";

export interface EngineDeviceSpec {
  definition: DeviceDefinition;
  schema: ParamSchema;
}

/** A device as it's written: stereo nodes allowed, made plain as it registers. */
export interface AuthoredDeviceSpec {
  definition: AuthoredDefinition;
  schema: ParamSchema;
}

const DEVICES = new Map<string, EngineDeviceSpec>();

/** Record that a device type runs on the new engine, and how. */
export const registerEngineDevice = (type: string, spec: AuthoredDeviceSpec): void => {
  DEVICES.set(type, { schema: spec.schema, definition: plainDefinition(spec.definition) });
};

/** Forget a device registered under `type` (a custom one, as its project unloads or drops it). */
export const unregisterEngineDevice = (type: string): void => {
  DEVICES.delete(type);
};

/** A type's engine definition, if it runs on the new engine. */
export const engineDevice = (type: string): EngineDeviceSpec | undefined => DEVICES.get(type);

[...ENGINE_INSTRUMENTS, ...ENGINE_EFFECTS].forEach((builtin) => registerEngineDevice(builtin.type, builtin));
