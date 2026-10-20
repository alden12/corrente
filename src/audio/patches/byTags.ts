/**
 * Patches found by what they sound like (AGENT-4.16): the patches carrying a brief's tags, best match
 * first, as worked examples to start from. An instrument's default settings count as its default
 * patch, carrying the instrument's own tags, so an instrument with no patches still turns up. A word
 * that isn't a tag comes back with the tags there are, for the model to pick its meaning from.
 * Shared by both MCP servers and the in-app agent.
 */
import { pickableInstrumentInfos } from "../instruments/catalog";
import { allPatches } from "./factory";
import type { Patch } from "./library";

/** The most patches a lookup returns, best matches first. */
const MAX_PATCHES = 12;

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

export function patchesByTags(words: string[]) {
  const patches = allPatches().map(patchSummary);
  const defaults = pickableInstrumentInfos().map((info) => ({
    instrument: info.type,
    name: `${info.label} (default settings)`,
    tags: info.tags ?? [],
  }));
  const inUse = new Set<string>([...patches, ...defaults].flatMap((entry) => entry.tags));
  const asked = words.map((word) => word.trim().toLowerCase());
  const tags = asked.filter((word) => inUse.has(word));
  const unknown = asked.filter((word) => !inUse.has(word));
  const matching = <Entry extends { tags: readonly string[] }>(entries: Entry[]) =>
    entries
      .map((entry) => ({ entry, score: entry.tags.filter((tag) => tags.includes(tag)).length }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ entry }) => entry);

  return {
    patches: matching(patches).slice(0, MAX_PATCHES),
    defaults: matching(defaults),
    // Only when a word missed, so a retry has the tags to choose from.
    ...(unknown.length ? { unknown, knownTags: [...inUse].sort() } : {}),
  };
}
