/**
 * A track's instrument (INST-36.7): made by its factory, unless it runs on the new engine, when it
 * also takes the engine effects straight after it into its own plan (one slot, no Web Audio between
 * them). Shared by AudioEngine and offline renders, so both build tracks the same way.
 */
import type { Instrument } from "../instruments/types";
import { SilentInstrument } from "../instruments/Silent";
import type { EffectInstance } from "../project/projectStore";
import type { ParamStore } from "../params/store";
import { engineDevice } from "../definitions/engineDevices";
import { applyBypass, chainPlan, leadingRun, memberOf, pieceKey, type ChainPlan } from "../bank/chainPlan";
import { EngineInstrument } from "../bank/EngineInstrument";

/** An engine instrument's plan with the effects it takes in, and which those are. */
interface InstrumentChain {
  plan: ChainPlan;
  absorbed: EffectInstance[];
}

/** The key of what an instrument took in, to see when it changes. */
export const absorbedKey = (absorbed: EffectInstance[]): string =>
  absorbed.length === 0 ? "" : pieceKey({ kind: "run", effects: absorbed });

/**
 * An engine instrument's plan with the run of engine effects after it, or alone if that would be too
 * heavy; undefined for an instrument not on the engine.
 */
export const instrumentChain = (
  type: string,
  store: ParamStore,
  effects: EffectInstance[],
  keyed: ReadonlySet<string> = new Set(),
): InstrumentChain | undefined => {
  if (!engineDevice(type)) return undefined;
  const instrument = { key: "instrument", type, store };
  // A keyed effect (part 5) needs a later stage than its key's track, so the run stops before it.
  const run = leadingRun(effects, keyed);
  const whole = run.length > 0 ? chainPlan([instrument, ...run.map((effect) => memberOf(effect))], true) : undefined;
  if (whole) return { plan: whole, absorbed: run };
  const alone = chainPlan([instrument], true);
  return alone && { plan: alone, absorbed: [] };
};

/** A track's instrument, and the effects of its chain it plays itself (the rest follow it). */
export const trackInstrument = (
  context: BaseAudioContext,
  type: string,
  store: ParamStore,
  effects: EffectInstance[],
): { instrument: Instrument; absorbed: EffectInstance[] } => {
  const chain = instrumentChain(type, store, effects);
  // Not on the engine: an empty track, or a custom instrument too old to play.
  if (!chain) return { instrument: new SilentInstrument(context), absorbed: [] };
  const instrument = new EngineInstrument(context, chain.plan);
  applyBypass(instrument, chain.plan.bypass, chain.absorbed);
  return { instrument, absorbed: chain.absorbed };
};

/**
 * Bring an engine instrument's plan in line with its chain: reloaded in place when the effects it
 * takes in change (what it keeps carries on, notes held and tails ringing; EngineDevice), bypass set
 * either way. Returns what it took in.
 */
export const updateTrackInstrument = (
  instrument: EngineInstrument,
  type: string,
  store: ParamStore,
  effects: EffectInstance[],
  before: EffectInstance[],
): EffectInstance[] => {
  const chain = instrumentChain(type, store, effects);
  if (!chain) return before;
  // Bypass before the reload, so an effect being added knows where to ramp to as it fades in.
  applyBypass(instrument, chain.plan.bypass, chain.absorbed);
  if (absorbedKey(chain.absorbed) !== absorbedKey(before)) instrument.reload(chain.plan);
  return chain.absorbed;
};
