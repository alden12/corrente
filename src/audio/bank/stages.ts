/**
 * Where in the signal flow an engine device's slot is (INST-36.7). DOM-free, so the effect registry
 * and the engines can place devices without loading the pool.
 *
 * A bank is one worklet node, and audio that leaves a node and comes back into it is a loop, which Web Audio silences. So a bank holds slots
 * of one stage, and audio only flows to later stages: instruments first, then a track's effects by
 * their place in its chain, then groups, the innermost first, each by its chain's places.
 */
/** Instruments: nothing feeds them. */
export const INSTRUMENT_STAGE = 0;
/** The most effects a chain may have before stages run into the next kind. */
const CHAIN = 100;
/** The deepest group nesting the stages allow for. */
const DEPTH = 50;
/** The stage of the effect at `index` in a track's chain. */
export const trackEffectStage = (index: number): number => 1 + Math.min(index, CHAIN - 2);
/** The stage of the effect at `index` in the chain of a group `depth` groups down (1 for a top group). */
export const groupEffectStage = (depth: number, index: number): number =>
  CHAIN * (1 + DEPTH - Math.min(depth, DEPTH)) + Math.min(index, CHAIN - 1);

/** Where a new effect goes: its stage. */
export interface EffectPlace {
  stage: number;
}

/** How many groups down a group is (1 for a top group), from each group's parent. */
export const groupDepth = (groups: readonly { id: string; parentId: string | null }[], id: string): number => {
  const parentOf = new Map(groups.map((group) => [group.id, group.parentId]));
  let depth = 1;
  // Bounded, in case of a cycle in bad data.
  for (let parent = parentOf.get(id); parent && depth < 1000; parent = parentOf.get(parent)) depth++;
  return depth;
};
