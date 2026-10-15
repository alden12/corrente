/**
 * The effect catalog: pure data (labels + parameter schemas), no audio/DOM.
 * Mirrors instruments/catalog.ts so the ProjectStore and the Node MCP server can
 * consume effect schemas without Web Audio types. What plays them is their
 * definitions, on the engine (definitions/engineDevices.ts). Every effect schema
 * includes a uniform `mix` (wet/dry).
 *
 * Effects are registered, not hardcoded: the built-ins (effects/engine/)
 * self-register below and `registerEffect` is the extension point a custom
 * device uses as its project loads.
 */
import type { ParamSchema } from "../params/types";
import type { Tag } from "../tags";
import { ENGINE_EFFECTS } from "./engine";

export interface EffectInfo {
  /** Stable id used on the wire, in persistence, and to address the factory. */
  type: string;
  label: string;
  schema: ParamSchema;
  /** Tags from the vocabulary (`tags.ts`), for Explore's chips and search. */
  tags?: readonly Tag[]; /** Authored in a project (by you or the agent), not shipped with the app: registered on load. */
  custom?: boolean;
}

/** The effect data registry (insertion order = palette / add-button order). */
const REGISTRY = new Map<string, EffectInfo>();

/** Register an effect's data (label + schema). DOM-free, for the server. */
export function registerEffect(info: EffectInfo): void {
  REGISTRY.set(info.type, info);
}

/** Remove a registered effect (custom, project-scoped devices are unregistered on unload). */
export function unregisterEffect(type: string): void {
  REGISTRY.delete(type);
}

/** Every registered effect, in registration order (iterate this, never hardcode). */
export function effectInfos(): EffectInfo[] {
  return [...REGISTRY.values()];
}

/** Whether an effect type is registered. */
export function hasEffect(type: string): boolean {
  return REGISTRY.has(type);
}

export const DEFAULT_EFFECT = "delay";

export function effectCatalogEntry(type: string): EffectInfo {
  return REGISTRY.get(type) ?? REGISTRY.get(DEFAULT_EFFECT)!;
}

export function effectSchema(type: string): ParamSchema {
  return effectCatalogEntry(type).schema;
}

// --- built-in effects (self-registered) -----------------------------------
// Every built-in is written in the engine's own format; engineDevices.ts plays their definitions.
ENGINE_EFFECTS.forEach(({ type, label, tags, schema }) => registerEffect({ type, label, schema, tags }));
