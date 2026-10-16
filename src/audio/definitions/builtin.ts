/**
 * A built-in written in the engine's own format (INST-42): its catalog entry and its definition
 * together, as pure data. The catalogs register its schema; engineDevices.ts plays its definition.
 */
import type { DeviceColor } from "../deviceColors";
import type { NumberSpec, ParamSchema } from "../params/types";
import type { Tag } from "../tags";
import type { AuthoredDefinition } from "./format";

export interface EngineBuiltin {
  type: string;
  label: string;
  /** An instrument's default group (InstrumentInfo.family). */
  family?: string;
  tags: readonly Tag[];
  /** Its colour in the rack and on Explore (DAW-61.2), picked so common chains contrast. */
  color: DeviceColor;
  schema: ParamSchema;
  definition: AuthoredDefinition;
}

/**
 * An effect's dry/wet: a param with this id is crossfaded around the effect by its chain (chain.ts),
 * so an effect plays only what it adds and leaves the dry signal to the chain.
 */
export const MIX: NumberSpec = { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.5, smoothMs: 20 };

/** Note divisions an effect can be timed to, as a choice. */
export const DIVISIONS = ["1/16", "1/8T", "1/8", "1/8.", "1/4T", "1/4", "1/4.", "1/2", "1/1"];
