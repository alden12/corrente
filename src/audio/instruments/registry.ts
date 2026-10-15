/**
 * Instrument factories (the audio side; uses Web Audio). The AudioEngine calls
 * createInstrument to realize a track. Pure catalog data (labels/schemas) lives
 * in catalog.ts so non-audio consumers (ProjectStore, MCP server) stay DOM-free.
 *
 * Factories are registered, mirroring the data registry in catalog.ts: a built-in
 * registers its schema (catalog.ts) and its factory (here); an external add-on
 * does the same two calls. `registerInstrumentFactory` is the audio half of the
 * extension point.
 */
import type { ParamStore } from "../params/store";
import type { Instrument } from "./types";
import { GraphInstrument } from "../graph/GraphInstrument";
import { BUILTIN_GRAPH_INSTRUMENTS } from "../graph/builtins";
import { WorkletInstrument } from "./WorkletInstrument";
import { SilentInstrument } from "./Silent";
import { DEFAULT_INSTRUMENT, EMPTY_INSTRUMENT } from "./catalog";

type InstrumentFactory = (ctx: BaseAudioContext, store: ParamStore) => Instrument;

const FACTORIES = new Map<string, InstrumentFactory>();

/** Register the audio factory for an instrument type (pair with registerInstrument). */
export function registerInstrumentFactory(type: string, factory: InstrumentFactory): void {
  FACTORIES.set(type, factory);
}

export function createInstrument(type: string, ctx: BaseAudioContext, store: ParamStore): Instrument {
  const make = FACTORIES.get(type) ?? FACTORIES.get(DEFAULT_INSTRUMENT)!;
  return make(ctx, store);
}

// --- built-in factories (self-registered) ---------------------------------
// Every instrument but Wavetable and Nimbus is a declarative graph (data, not code). Those two are
// whole polyphonic synths in one worklet each (INST-15, INST-19). The graph ones play on the new
// engine, converted (definitions/engineDevices.ts); these factories go with the old engine
// (INST-36.8 part 6).
BUILTIN_GRAPH_INSTRUMENTS.forEach((def) =>
  registerInstrumentFactory(def.type, (ctx, store) => new GraphInstrument(ctx, store, def)),
);
registerInstrumentFactory("wavetable", (ctx, store) => new WorkletInstrument(ctx, store, "wavetable-processor"));
registerInstrumentFactory("nimbus", (ctx, store) => new WorkletInstrument(ctx, store, "nimbus-processor"));
registerInstrumentFactory(EMPTY_INSTRUMENT, (ctx) => new SilentInstrument(ctx));

export { instrumentInfos, instrumentSchema, catalogEntry, hasInstrument, DEFAULT_INSTRUMENT } from "./catalog";
