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
import { carryWords } from "./carry";
import { ownerOf, type ChainEdit, type ChainLayout } from "./chainPlan";

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
