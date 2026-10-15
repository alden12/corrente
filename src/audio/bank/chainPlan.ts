/**
 * Which of a chain's devices run as one engine plan (INST-36.7), and that plan. A track's chain splits
 * into pieces: runs of consecutive engine effects, each one plan on one slot, and the other effects
 * on their own. An engine instrument takes the run straight after it into its own plan.
 *
 * A run that would be too heavy for a phone as one plan (the cost cap) splits: the instrument plays
 * alone, or each effect gets its own slot.
 */
import type { ParamStore } from "../params/store";
import { BYPASS, chainParam, composeChain, type ChainLink } from "../definitions/chain";
import { compileDefinition, DefinitionError, type CompiledPlan } from "../definitions/compile";
import { engineDevice } from "../definitions/engineDevices";
import type { EffectInstance } from "../project/projectStore";
import { EngineEffect } from "./EngineEffect";

/** One device in a chain: its key (the effect's id), type and params. */
export interface ChainMember {
  key: string;
  type: string;
  store: ParamStore;
  /** Keyed by another track (part 5): its sidechain is the slot's. */
  keyed?: boolean;
}

/** Which devices a chain's plan is made of, in order, and each effect's bypass param. */
export interface ChainLayout {
  keys: string[];
  /** The bypass param of each member that is an effect, by key. */
  bypass: Map<string, string>;
}

/**
 * Where each of a chain's plan params comes from: a device's store and the param's id there, read
 * under its namespace. A plan param with no source (an effect's bypass) is set with `setFixed`.
 */
export type ParamSources = Record<string, { store: ParamStore; id: string }>;

/** A chain's devices as one plan, and where each param comes from. */
export interface ChainPlan extends ChainLayout {
  plan: CompiledPlan;
  sources: ParamSources;
}

/**
 * `members` as one plan (the first an instrument if `instrument`), or undefined if one isn't an
 * engine device or together they're too heavy for a phone.
 */
export const chainPlan = (members: ChainMember[], instrument: boolean): ChainPlan | undefined => {
  const links = members.map((member, index): ChainLink | undefined => {
    const spec = engineDevice(member.type);
    return spec && { key: member.key, ...spec, effect: !(instrument && index === 0), keyed: member.keyed };
  });
  if (links.some((link) => !link)) return undefined;
  const composed = composeChain(links as ChainLink[]);
  let plan: CompiledPlan;
  try {
    plan = compileDefinition(composed.definition, { params: composed.schema });
  } catch (error) {
    if (error instanceof DefinitionError) return undefined;
    throw error;
  }
  const sources: ParamSources = Object.fromEntries(
    Object.entries(composed.params)
      .filter(([, { param }]) => param !== BYPASS)
      .map(([name, { link, param }]) => [name, { store: members[link].store, id: param }]),
  );
  const bypass = new Map(
    members
      .filter((_, index) => !(instrument && index === 0))
      .map((member) => [member.key, chainParam(member.key, BYPASS)]),
  );
  return { plan, sources, keys: members.map((member) => member.key), bypass };
};

/** An effect instance as a chain member; `keyed` if another track keys it. */
export const memberOf = (effect: EffectInstance, keyed = false): ChainMember => ({
  key: effect.id,
  type: effect.type,
  store: effect.params,
  ...(keyed ? { keyed } : {}),
});

/** Whether an effect runs on the new engine. */
export const isEngineEffect = (effect: EffectInstance): boolean => engineDevice(effect.type) !== undefined;

/** A piece of a chain: a run of engine effects (one plan), or any other effect on its own. */
export type ChainPiece = { kind: "run"; effects: EffectInstance[] } | { kind: "single"; effect: EffectInstance };

/**
 * A chain cut into pieces: consecutive engine effects together, the rest one by one. An effect
 * another track keys (by id in `keyed`) is a run of its own: its slot's sidechain is its key, and
 * it sits at a later stage than the key's track.
 */
export const piecesOf = (effects: EffectInstance[], keyed: ReadonlySet<string> = new Set()): ChainPiece[] =>
  effects.reduce<ChainPiece[]>((pieces, effect, index) => {
    const last = pieces[pieces.length - 1];
    if (!isEngineEffect(effect)) return [...pieces, { kind: "single", effect }];
    const joins = last?.kind === "run" && !keyed.has(effect.id) && !keyed.has(effects[index - 1].id);
    if (joins) return [...pieces.slice(0, -1), { kind: "run", effects: [...last.effects, effect] }];
    return [...pieces, { kind: "run", effects: [effect] }];
  }, []);

/** The engine effects straight after an engine instrument: the run its plan takes in, up to a keyed one. */
export const leadingRun = (effects: EffectInstance[], keyed: ReadonlySet<string> = new Set()): EffectInstance[] => {
  const end = effects.findIndex((effect) => !isEngineEffect(effect) || keyed.has(effect.id));
  return effects.slice(0, end < 0 ? effects.length : end);
};

/** A piece's key: what it is made of, so a change of membership makes it again. */
export const pieceKey = (piece: ChainPiece): string =>
  piece.kind === "run" ? piece.effects.map((effect) => `${effect.id}:${effect.type}`).join("+") : piece.effect.id;

/** Set each effect's bypass in a plan from its instance. */
export const applyBypass = (
  target: { setFixed(param: string, value: number): void },
  bypass: Map<string, string>,
  effects: EffectInstance[],
): void =>
  effects.forEach((effect) => {
    const param = bypass.get(effect.id);
    if (param) target.setFixed(param, effect.bypassed ? 1 : 0);
  });

/**
 * A run of engine effects as engine slots: one plan at the first effect's stage if they compose within
 * the cost cap, or else one each, each at its own stage (`stageOf`, its place in the chain), so a
 * split run never loops through one bank. Each with its bypass params set.
 */
export const runEffects = (
  context: BaseAudioContext,
  run: EffectInstance[],
  stageOf: (effect: EffectInstance) => number,
  keys: ReadonlyMap<string, AudioNode> = new Map(),
): EngineEffect[] => {
  const member = (effect: EffectInstance) => memberOf(effect, keys.has(effect.id));
  const whole = chainPlan(run.map(member), false);
  const parts = whole
    ? [{ plan: whole, effects: run }]
    : run.map((effect) => ({ plan: chainPlan([member(effect)], false), effects: [effect] }));
  return parts.flatMap(({ plan, effects }) => {
    if (!plan) {
      console.error(`${effects[0].type}: too heavy for the engine`);
      return [];
    }
    // A keyed effect is a run of its own (piecesOf), so a part has at most one key.
    const key = effects.map((each) => keys.get(each.id)).find((node) => node !== undefined);
    const effect = new EngineEffect(context, plan, stageOf(effects[0]), key);
    applyBypass(effect, plan.bypass, effects);
    return [effect];
  });
};
