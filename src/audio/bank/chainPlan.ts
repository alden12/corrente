/**
 * Which of a chain's devices run as one engine plan (INST-36.7), and that plan. A track's chain splits
 * into pieces: runs of consecutive engine effects, each one plan on one slot, and the other effects
 * on their own. An engine instrument takes the run straight after it into its own plan.
 *
 * A run that would be too heavy for a phone as one plan (the cost cap) splits: the instrument plays
 * alone, or each effect gets its own slot.
 */
import type { ParamStore } from "../params/store";
import { BYPASS, chainParam, composeChain, linkPrefix, type ChainLink } from "../definitions/chain";
import { compileDefinition, DefinitionError, type CompiledPlan } from "../definitions/compile";
import { engineDevice } from "../definitions/engineDevices";
import type { EffectInstance } from "../project/projectStore";
import type { ParamSources } from "./EngineDevice";
import { EngineEffect } from "./EngineEffect";

/** One device in a chain: its key (the effect's id), type and params. */
export interface ChainMember {
  key: string;
  type: string;
  store: ParamStore;
}

/** Which devices a chain's plan is made of, in order, and each effect's bypass param. */
export interface ChainLayout {
  keys: string[];
  /** The bypass param of each member that is an effect, by key. */
  bypass: Map<string, string>;
}

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
    return spec && { key: member.key, ...spec, effect: !(instrument && index === 0) };
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

/**
 * A change of a chain's devices that can keep state (part 3): the devices in both, still in the same
 * order, and those added and removed. Undefined if the ones kept have moved around, since their
 * inputs then change at once: that reload crossfades instead.
 */
export interface ChainEdit {
  kept: Set<string>;
  added: string[];
  removed: string[];
}

export const chainEdit = (before: string[], after: string[]): ChainEdit | undefined => {
  const keptAfter = after.filter((key) => before.includes(key));
  const keptBefore = before.filter((key) => after.includes(key));
  if (keptAfter.length === 0 || keptAfter.some((key, index) => keptBefore[index] !== key)) return undefined;
  return {
    kept: new Set(keptAfter),
    added: after.filter((key) => !before.includes(key)),
    removed: before.filter((key) => !after.includes(key)),
  };
};

/**
 * The device a node of a chain's plan belongs to: the key whose prefix it starts with, the longest
 * if several do (one key's prefix can begin another's).
 */
export const ownerOf = (keys: string[], name: string): string | undefined =>
  keys
    .filter((key) => name.startsWith(linkPrefix(key)))
    .reduce<string | undefined>((longest, key) => (longest && longest.length >= key.length ? longest : key), undefined);

/** An effect instance as a chain member. */
export const memberOf = (effect: EffectInstance): ChainMember => ({
  key: effect.id,
  type: effect.type,
  store: effect.params,
});

/** Whether an effect runs on the new engine. */
export const isEngineEffect = (effect: EffectInstance): boolean => engineDevice(effect.type) !== undefined;

/** A piece of a chain: a run of engine effects (one plan), or any other effect on its own. */
export type ChainPiece = { kind: "run"; effects: EffectInstance[] } | { kind: "single"; effect: EffectInstance };

/** A chain cut into pieces: consecutive engine effects together, the rest one by one. */
export const piecesOf = (effects: EffectInstance[]): ChainPiece[] =>
  effects.reduce<ChainPiece[]>((pieces, effect) => {
    const last = pieces[pieces.length - 1];
    if (!isEngineEffect(effect)) return [...pieces, { kind: "single", effect }];
    if (last?.kind === "run") return [...pieces.slice(0, -1), { kind: "run", effects: [...last.effects, effect] }];
    return [...pieces, { kind: "run", effects: [effect] }];
  }, []);

/** The engine effects straight after an engine instrument: the run its plan takes in. */
export const leadingRun = (effects: EffectInstance[]): EffectInstance[] => {
  const end = effects.findIndex((effect) => !isEngineEffect(effect));
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
): EngineEffect[] => {
  const whole = chainPlan(run.map(memberOf), false);
  const parts = whole
    ? [{ plan: whole, effects: run }]
    : run.map((effect) => ({ plan: chainPlan([memberOf(effect)], false), effects: [effect] }));
  return parts.flatMap(({ plan, effects }) => {
    if (!plan) {
      console.error(`${effects[0].type}: too heavy for the engine`);
      return [];
    }
    const effect = new EngineEffect(context, plan.plan, plan.sources, stageOf(effects[0]), plan);
    applyBypass(effect, plan.bypass, effects);
    return [effect];
  });
};
