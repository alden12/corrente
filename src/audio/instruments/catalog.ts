/**
 * The instrument catalog: pure data (labels + parameter schemas), no audio/DOM.
 * This is what the ProjectStore and the Node MCP server consume to build param
 * stores and describe instruments. The audio factories live in registry.ts
 * (DOM); keeping them apart lets the server type-check without Web Audio types.
 *
 * Instruments are *registered*, not hardcoded: built-ins self-register at the
 * bottom of this file, and `registerInstrument` is the extension point an
 * add-on (eventually a plugin package) calls to contribute a new instrument
 * without editing the core. Because the parameter schema is the keystone, a
 * registered instrument appears in the UI, the MCP palette, automation, and
 * persistence automatically. (Runtime registration trades the old compile-time
 * "every cataloged type has a factory" check for external extensibility; the
 * factory half lives in registry.ts and is registered alongside.)
 */
import type { ParamSchema } from "../params/types";
import type { Tag } from "../tags";
import { ENGINE_INSTRUMENTS } from "./engine";

export interface InstrumentInfo {
  /** Stable id used on the wire, in persistence, and to address the factory. */
  type: string;
  label: string;
  schema: ParamSchema;
  /** A default group name (kept for the catalog shape; grouping is now a single "main"). */
  family: string;
  /**
   * Hidden from the library palette + search (still registered so its schema/factory
   * resolve). Used by the "none" sentinel - an empty track with no instrument yet.
   */
  hidden?: boolean;
  /** Tags from the vocabulary (`tags.ts`), for Explore's chips and search. */
  tags?: readonly Tag[]; /** Authored in a project (by you or the agent), not shipped with the app: registered on load. */
  custom?: boolean;
}

/** The sentinel instrument type for an empty track (no instrument chosen yet). */
export const EMPTY_INSTRUMENT = "none";

/** The instrument data registry (insertion order = catalog/palette order). */
const REGISTRY = new Map<string, InstrumentInfo>();

/** Register an instrument's data (label + schema + family). The audio factory is
 *  registered separately in registry.ts, so this stays DOM-free for the server. */
export function registerInstrument(info: InstrumentInfo): void {
  REGISTRY.set(info.type, info);
}

/** Remove a registered instrument (custom, project-scoped devices are unregistered on unload). */
export function unregisterInstrument(type: string): void {
  REGISTRY.delete(type);
}

/** Every registered instrument, in registration order (iterate this, never hardcode). */
export function instrumentInfos(): InstrumentInfo[] {
  return [...REGISTRY.values()];
}

/** Registered instruments a user can pick (excludes hidden sentinels like "none"). */
export function pickableInstrumentInfos(): InstrumentInfo[] {
  return [...REGISTRY.values()].filter((info) => !info.hidden);
}

/** Whether an instrument type is registered. */
export function hasInstrument(type: string): boolean {
  return REGISTRY.has(type);
}

export const DEFAULT_INSTRUMENT = "subtractive";

/** The entry for a type, falling back to the default for unknown ids. */
export function catalogEntry(type: string): InstrumentInfo {
  return REGISTRY.get(type) ?? REGISTRY.get(DEFAULT_INSTRUMENT)!;
}

export function instrumentSchema(type: string): ParamSchema {
  return catalogEntry(type).schema;
}

/** Default group family for an instrument type (see InstrumentInfo.family). */
export function instrumentFamily(type: string): string {
  return catalogEntry(type).family;
}

// --- built-in instruments (self-registered) -------------------------------
// Every built-in is written in the engine's own format; engineDevices.ts plays their definitions.
ENGINE_INSTRUMENTS.forEach(({ type, label, family = "Synths", tags, schema }) =>
  registerInstrument({ type, label, schema, family, tags }),
);
// The empty-track sentinel: no params, hidden from the palette, silent factory (registry.ts).
registerInstrument({ type: EMPTY_INSTRUMENT, label: "No instrument", schema: [], family: "main", hidden: true });
