/**
 * What a reloaded plan takes over from the one it replaces (INST-36.7): the words `eng_carry` reads.
 * A node carries on if the old plan had one of the same name running the same block, and the caller
 * says it is kept (a chain's device that is in both plans). The voices carry on whole, held notes and
 * all, only if the voice section is the same nodes in the same order and every one is kept.
 *
 * The engine checks the words fit both plans, so a wrong guess here is refused rather than played.
 */
import type { CompiledPlan, PlanNode, Section } from "../definitions/compile";

/** The words for `eng_carry`, or undefined if nothing carries. */
export const carryWords = (
  before: CompiledPlan,
  after: CompiledPlan,
  kept: (name: string) => boolean,
): Int32Array | undefined => {
  const sameNode = (node: PlanNode, other: PlanNode | undefined) =>
    other !== undefined && node.name === other.name && node.block === other.block;
  const map = (section: Section) => {
    const old = new Map(before.nodes[section].map((node, index) => [node.name, index]));
    return after.nodes[section].map((node) => {
      const index = old.get(node.name);
      return index !== undefined && kept(node.name) && sameNode(node, before.nodes[section][index]) ? index : -1;
    });
  };
  // A plan with no voice section (an effect's) has no voices to carry.
  const voices =
    after.nodes.voice.length > 0 &&
    before.voices === after.voices &&
    after.nodes.voice.length === before.nodes.voice.length &&
    after.nodes.voice.every((node, index) => kept(node.name) && sameNode(node, before.nodes.voice[index]));
  const pre = map("pre");
  const post = map("post");
  const carried = voices || [...pre, ...post].some((index) => index >= 0);
  return carried ? Int32Array.from([voices ? 1 : 0, pre.length, ...pre, post.length, ...post]) : undefined;
};

/** Whether `carryWords` carries the voices. */
export const carriesVoices = (words: Int32Array): boolean => words[0] === 1;
