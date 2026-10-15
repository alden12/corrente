/**
 * The devices that run on the new engine, by type (INST-36.7): their definitions and param schemas,
 * so a track's chain can compose its engine devices into one plan (chain.ts). DOM-free.
 *
 * The built-ins written in the old graph format run here converted (INST-36.8), each converted the
 * first time it's asked for. Their schemas don't change, so a project's values for them carry over.
 */
import { BUILTIN_GRAPH_EFFECTS, BUILTIN_GRAPH_INSTRUMENTS } from "../graph/builtins";
import type { ParamSchema } from "../params/types";
import type { DeviceDefinition } from "./format";
import { effectFromGraph, instrumentFromGraph, type Converted } from "./fromGraph";

export interface EngineDeviceSpec {
  definition: DeviceDefinition;
  schema: ParamSchema;
}

const DEVICES = new Map<string, EngineDeviceSpec>();

/** Each built-in's conversion, made when first asked for. */
const BUILTINS = new Map<string, () => Converted>([
  ...BUILTIN_GRAPH_INSTRUMENTS.map((def) => [def.type, () => instrumentFromGraph(def)] as const),
  ...BUILTIN_GRAPH_EFFECTS.map((def) => [def.type, () => effectFromGraph(def)] as const),
]);

/** Record that a device type runs on the new engine, and how. */
export const registerEngineDevice = (type: string, spec: EngineDeviceSpec): void => {
  DEVICES.set(type, spec);
};

/** A type's engine definition, if it runs on the new engine. */
export const engineDevice = (type: string): EngineDeviceSpec | undefined => {
  const registered = DEVICES.get(type);
  if (registered) return registered;
  const convert = BUILTINS.get(type);
  if (!convert) return undefined;
  const { definition, schema } = convert();
  const spec = { definition, schema };
  DEVICES.set(type, spec);
  return spec;
};
