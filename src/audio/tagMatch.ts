/**
 * Matching the words for a sound to the tags there are (COMM-1.11.4), forgiving spelling: "glasy"
 * finds glassy. Catches spellings, not meanings ("shiny" won't find bright; that's COMM-1.11.5).
 *
 * The similarity is Postgres's pg_trgm, written out here so the device's library (offline, signed
 * out) and the account's (the hosted server, where pg_trgm runs it with an index) resolve a word to
 * the same tag: each word lower-cased and padded, cut into three-letter pieces, and scored as the
 * pieces two strings share over all the pieces either has.
 */

/** pg_trgm's own default: the least similarity its `%` operator counts as a match. */
export const TAG_SIMILARITY = 0.3;

/** The most near tags offered for a word that matched none. */
const NEAREST = 5;

/** A string's trigrams as pg_trgm takes them: per word, padded with two spaces before and one after. */
function trigrams(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return new Set(
    words.flatMap((word) => {
      const padded = `  ${word} `;
      return Array.from({ length: padded.length - 2 }, (_, index) => padded.slice(index, index + 3));
    }),
  );
}

/** How alike two strings are, 0 to 1: pg_trgm's `similarity()`. */
export function similarity(left: string, right: string): number {
  const ours = trigrams(left);
  const theirs = trigrams(right);
  const shared = [...ours].filter((trigram) => theirs.has(trigram)).length;
  const all = ours.size + theirs.size - shared;
  return all === 0 ? 0 : shared / all;
}

/** The tags most like `word`, best first, that count as a match. */
export const nearestTags = (word: string, vocabulary: Iterable<string>, limit = NEAREST): string[] =>
  [...vocabulary]
    .map((tag) => ({ tag, score: similarity(word, tag) }))
    .filter(({ score }) => score >= TAG_SIMILARITY)
    .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag))
    .slice(0, limit)
    .map(({ tag }) => tag);

/** What a lookup made of the words it was given. */
export interface ResolvedTags {
  /** The tags to look up: each word's own, or its nearest. */
  tags: string[];
  /** Words taken as another tag, and which: `{ glasy: "glassy" }`. */
  readAs?: Record<string, string>;
  /** Words like no tag there is. */
  unknown?: string[];
}

/**
 * Each word as a tag: itself where it is one, else the tag most like it. Shared by the device's
 * lookup and the hosted one, which hands in its nearest tags from the index (`nearest`).
 */
export function resolveTags(
  words: readonly string[],
  isTag: (word: string) => boolean,
  nearest: (word: string) => string[],
): ResolvedTags {
  const asked = [...new Set(words.map((word) => word.trim().toLowerCase()).filter(Boolean))];
  const resolved = asked.map((word) => ({ word, tag: isTag(word) ? word : nearest(word)[0] }));
  const readAs = Object.fromEntries(
    resolved.flatMap(({ word, tag }) => (tag !== undefined && tag !== word ? [[word, tag]] : [])),
  );
  const unknown = resolved.filter(({ tag }) => tag === undefined).map(({ word }) => word);
  return {
    tags: [...new Set(resolved.flatMap(({ tag }) => (tag === undefined ? [] : [tag])))],
    ...(Object.keys(readAs).length ? { readAs } : {}),
    ...(unknown.length ? { unknown } : {}),
  };
}
