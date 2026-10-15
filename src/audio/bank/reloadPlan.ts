/**
 * How a chain's plan replaces the one before it (INST-36.7): what carries on, and which effects fade
 * in from bypassed. Pure, so EngineDevice only sends what this works out.
 *
 * - **Kept devices carry on** (carry.ts), unless they moved: an effect that changed places starts
 *   fresh, since its state was made from a different input (an echo of resonator output, put back in
 *   front of the resonator, is resonated twice and comes out ten times as loud). The instrument,
 *   among `moved` on any reorder, keeps its state.
 * - **Added and moved effects fade in:** their bypass starts at 1 and ramps to where it's set, so
 *   they come in from the dry signal they pass through, whether or not anything else carries.
 * - **So do effects that were fading out:** a removal bypasses the effect, then loads the plan
 *   without it a little later. Undone before then, the effect is still in the new plan with its
 *   bypass ramping up, so it ramps back rather than jumping.
 */
import type { CompiledPlan } from "../definitions/compile";
import type { LoadOptions } from "./bank";
import { linkPrefix } from "../definitions/chain";
import { carryWords } from "./carry";
import type { ChainLayout } from "./chainPlan";

/**
 * A change of a chain's devices, keeping the state of those in both (part 3): which those are, and
 * which were added and removed. If the kept ones changed order, they are all `moved`: their inputs
 * change at once, so the effects among them fade out around the reload, start fresh and fade back in
 * (EngineDevice). Undefined if nothing is kept.
 */
export interface ChainEdit {
  kept: Set<string>;
  added: string[];
  removed: string[];
  moved: string[];
}

export const chainEdit = (before: string[], after: string[]): ChainEdit | undefined => {
  const keptAfter = after.filter((key) => before.includes(key));
  const keptBefore = before.filter((key) => after.includes(key));
  if (keptAfter.length === 0) return undefined;
  const reordered = keptAfter.some((key, index) => keptBefore[index] !== key);
  return {
    kept: new Set(keptAfter),
    added: after.filter((key) => !before.includes(key)),
    removed: before.filter((key) => !after.includes(key)),
    moved: reordered ? keptAfter : [],
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

/** A plan as last sent to the bank, with the chain it was made of. */
export interface Sent {
  plan: CompiledPlan;
  chain?: ChainLayout;
}

/**
 * The load options for `plan` (made of `chain`) after `before`, given the `edit` between their
 * chains and the bypass params sent to 1 for a removal that hasn't loaded (`fadingOut`).
 */
export const reloadOptions = (
  before: Sent | undefined,
  plan: CompiledPlan,
  chain: ChainLayout | undefined,
  edit: ChainEdit | undefined,
  fadingOut: ReadonlySet<string> = new Set(),
): LoadOptions => {
  const keys = [...(before?.chain?.keys ?? []), ...(chain?.keys ?? [])];
  const fresh = new Set((edit?.moved ?? []).filter((key) => chain?.bypass.has(key)));
  const carry =
    edit && before
      ? carryWords(before.plan, plan, (name) => {
          const owner = ownerOf(keys, name) ?? "";
          return edit.kept.has(owner) && !fresh.has(owner);
        })
      : undefined;
  const reads = new Set(plan.params.map((source) => source.param));
  const fading = [
    ...[...(edit?.added ?? []), ...(edit?.moved ?? [])].flatMap((key) => chain?.bypass.get(key) ?? []),
    ...[...fadingOut].filter((param) => reads.has(param)),
  ];
  return {
    ...(carry ? { carry } : {}),
    ...(fading.length > 0 ? { from: Object.fromEntries(fading.map((param) => [param, 1])) } : {}),
  };
};
