/**
 * The devices that run on the new engine, by type (INST-36.7): their definitions and param schemas,
 * so a track's chain can compose its engine devices into one plan (chain.ts). Stereo nodes are made
 * plain as a device registers (stereo.ts), so chains only ever see plain ones. DOM-free.
 *
 * The built-ins written in the old graph format run here converted (INST-36.8), each converted the
 * first time it's asked for. Their schemas don't change, so a project's values for them carry over.
 * Those written in this format (INST-42) are taken as they are.
 */
import { BUILTIN_GRAPH_EFFECTS, BUILTIN_GRAPH_INSTRUMENTS } from "../graph/builtins";
import type { ParamSchema } from "../params/types";
import type { AuthoredDefinition, DeviceDefinition } from "./format";
import { effectFromGraph, instrumentFromGraph } from "./fromGraph";
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

/** Each built-in: converted from the old format when first asked for, or written in this one. */
const BUILTINS = new Map<string, () => AuthoredDeviceSpec>([
  ...BUILTIN_GRAPH_INSTRUMENTS.map((def) => [def.type, () => instrumentFromGraph(def)] as const),
  ...BUILTIN_GRAPH_EFFECTS.map((def) => [def.type, () => effectFromGraph(def)] as const),
  ...[...ENGINE_INSTRUMENTS, ...ENGINE_EFFECTS].map((builtin) => [builtin.type, () => builtin] as const),
]);

/** Record that a device type runs on the new engine, and how. */
export const registerEngineDevice = (type: string, spec: AuthoredDeviceSpec): void => {
  DEVICES.set(type, { schema: spec.schema, definition: plainDefinition(spec.definition) });
};

/** Forget a device registered under `type` (a custom one, as its project unloads or drops it). */
export const unregisterEngineDevice = (type: string): void => {
  DEVICES.delete(type);
};

/** A type's engine definition, if it runs on the new engine. */
export const engineDevice = (type: string): EngineDeviceSpec | undefined => {
  const registered = DEVICES.get(type);
  if (registered) return registered;
  const builtin = BUILTINS.get(type);
  if (!builtin) return undefined;
  const { definition, schema } = builtin();
  registerEngineDevice(type, { definition, schema });
  return DEVICES.get(type);
};
