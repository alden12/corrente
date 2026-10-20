/**
 * Patches found by what they sound like (AGENT-4.16): the patches carrying a brief's tags, best match
 * first, as worked examples to start from. An instrument's default settings count as its default
 * patch, carrying the instrument's own tags, so an instrument with no patches still turns up. A word
 * that isn't a tag comes back with the tags there are, for the model to pick its meaning from.
 * Shared by both MCP servers and the in-app agent.
 */
import { pickableInstrumentInfos } from "../instruments/catalog";
import { byTagOrder } from "../tags";
import { nearestTags, resolveTags } from "../tagMatch";
import type { Patch } from "./library";

/** How many tags a word that matched none is answered with: the most used. */
export const KNOWN_TAGS = 40;

/** How a patch is listed. */
export const patchSummary = (patch: Patch) => ({
  id: patch.id,
  name: patch.name,
  author: patch.author,
  instrument: patch.instrumentType,
  builtin: patch.builtin ?? false,
  tags: patch.tags ?? [],
  ...(patch.description ? { description: patch.description } : {}),
  effects: patch.effects.map((effect) => effect.type),
});

/** The tags most used across `entries`, most used first, `limit` of them. */
export const mostUsedTags = (entries: readonly { tags: readonly string[] }[], limit = KNOWN_TAGS): string[] => {
  const counts = new Map<string, number>();
  entries.flatMap((entry) => entry.tags).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  return [...counts]
    .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || byTagOrder(left, right))
    .slice(0, limit)
    .map(([tag]) => tag);
};

/**
 * `patches` carrying the words' tags, best match first; with `withDefaults`, the instruments whose
 * default settings carry them too. A misspelt word is read as the tag most like it (`readAs`), and
 * one like no tag comes back with the most used tags, for the model to pick its meaning from.
 */
export function patchesByTags(words: string[], patches: readonly Patch[], withDefaults = true) {
  const summaries = patches.map(patchSummary);
  const defaults = withDefaults
    ? pickableInstrumentInfos().map((info) => ({
        instrument: info.type,
        name: `${info.label} (default settings)`,
        tags: info.tags ?? [],
      }))
    : [];
  const inUse = new Set<string>([...summaries, ...defaults].flatMap((entry) => entry.tags));
  const { tags, readAs, unknown } = resolveTags(
    words,
    (word) => inUse.has(word),
    (word) => nearestTags(word, inUse),
  );
  const matching = <Entry extends { tags: readonly string[] }>(entries: Entry[]) =>
    entries
      .map((entry) => ({ entry, score: entry.tags.filter((tag) => tags.includes(tag)).length }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ entry }) => entry);

  return {
    patches: matching(summaries),
    ...(withDefaults ? { defaults: matching(defaults) } : {}),
    ...(readAs ? { readAs } : {}),
    // Only when a word missed, so a retry has tags to choose from.
    ...(unknown ? { unknown, knownTags: mostUsedTags([...summaries, ...defaults]) } : {}),
  };
}
