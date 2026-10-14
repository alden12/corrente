/**
 * The devices that run on the new engine, by type (INST-36.7): their definitions and param schemas,
 * so a track's chain can compose its engine devices into one plan (chain.ts). DOM-free. The test
 * devices register here now; the built-ins and custom devices will with INST-36.8.
 */
import type { ParamSchema } from "../params/types";
import type { DeviceDefinition } from "./format";

export interface EngineDeviceSpec {
  definition: DeviceDefinition;
  schema: ParamSchema;
}

const DEVICES = new Map<string, EngineDeviceSpec>();

/** Record that a device type runs on the new engine, and how. */
export const registerEngineDevice = (type: string, spec: EngineDeviceSpec): void => {
  DEVICES.set(type, spec);
};

/** A type's engine definition, if it runs on the new engine. */
export const engineDevice = (type: string): EngineDeviceSpec | undefined => DEVICES.get(type);
