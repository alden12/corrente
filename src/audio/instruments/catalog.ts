/**
 * The instrument catalog: pure data (labels + parameter schemas), no audio/DOM.
 * This is what the ProjectStore and the Node MCP server consume to build param
 * stores and describe instruments. What plays them is their definitions, on the
 * engine (definitions/engineDevices.ts).
 *
 * Instruments are *registered*, not hardcoded: the built-ins (instruments/engine/)
 * self-register at the bottom of this file, and `registerInstrument` is the
 * extension point a custom device uses as its project loads. Because the parameter
 * schema is the keystone, a registered instrument appears in the UI, the MCP
 * palette, automation, and persistence automatically.
 */
import type { ParamSchema } from "../params/types";
import type { Tag } from "../tags";
import type { DeviceColor } from "../deviceColors";
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
  tags?: readonly Tag[];
  /** Its colour (DAW-61.2); read it through `deviceColor`, which fills in one that is missing. */
  color?: DeviceColor;
  /** Authored in a project (by you or the agent), not shipped with the app: registered on load. */
  custom?: boolean;
}

/** The sentinel instrument type for an empty track (no instrument chosen yet). */
export const EMPTY_INSTRUMENT = "none";

/** The instrument data registry (insertion order = catalog/palette order). */
const REGISTRY = new Map<string, InstrumentInfo>();

/** Register an instrument's data (label + schema + family). DOM-free, for the server. */
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
ENGINE_INSTRUMENTS.forEach(({ type, label, family = "Synths", tags, color, schema }) =>
  registerInstrument({ type, label, schema, family, tags, color }),
);
// The empty-track sentinel: no params, hidden from the palette, silent (instruments/Silent.ts).
registerInstrument({ type: EMPTY_INSTRUMENT, label: "No instrument", schema: [], family: "main", hidden: true });
