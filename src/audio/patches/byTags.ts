/**
 * Patches found by what they sound like (AGENT-4.16): a brief's words resolved to tags (directly, or
 * through a tag note's synonyms), and the patches carrying them, as worked examples to start from.
 * An instrument's default settings count as its default patch, carrying the instrument's own tags,
 * so an instrument with no patches still turns up. Each matched tag brings its note and check when
 * it has one (tagNotes.ts). Shared by both MCP servers and the in-app agent.
 */
import { pickableInstrumentInfos } from "../instruments/catalog";
import { TAG_NOTES } from "../tagNotes";
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
  effects: patch.effects.map((effect) => effect.type),
});

const SYNONYMS = new Map(
  Object.entries(TAG_NOTES).flatMap(([tag, { synonyms }]) => synonyms.map((synonym) => [synonym, tag] as const)),
);

export function patchesByTags(words: string[]) {
  const patches = allPatches();
  const defaults = pickableInstrumentInfos().map((info) => ({
    instrument: info.type,
    name: `${info.label} (default settings)`,
    tags: info.tags ?? [],
  }));
  const inUse = new Set<string>([
    ...patches.flatMap((patch) => patch.tags ?? []),
    ...defaults.flatMap((entry) => entry.tags),
    ...Object.keys(TAG_NOTES),
  ]);
  // A word that is a tag stays itself; otherwise a synonym says which tag it means.
  const resolved = words.map((word) => {
    const plain = word.trim().toLowerCase();
    return { word, tag: inUse.has(plain) ? plain : SYNONYMS.get(plain) };
  });
  const tags = [...new Set(resolved.flatMap(({ tag }) => (tag ? [tag] : [])))];
  const unknown = resolved.filter(({ tag }) => !tag).map(({ word }) => word);
  const matching = <Entry extends { tags: readonly string[] }>(entries: Entry[]) =>
    entries
      .map((entry) => ({ entry, score: entry.tags.filter((tag) => tags.includes(tag)).length }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ entry }) => entry);

  return {
    tags: tags.map((tag) => {
      const note = TAG_NOTES[tag];
      return note ? { tag, note: note.note, check: note.check } : { tag };
    }),
    patches: matching(patches.map(patchSummary)).slice(0, MAX_PATCHES),
    defaults: matching(defaults),
    // Only when a word missed, so a retry has the words to choose from.
    ...(unknown.length ? { unknown, knownTags: [...inUse, ...SYNONYMS.keys()].sort() } : {}),
  };
}
