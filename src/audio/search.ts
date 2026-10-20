/**
 * Searching a list by words (COMM-1.11.4): Explore's search box and list_patches' `query`, one rule,
 * so the app and its agents find the same things.
 *
 * Every word must match an item: inside its name or description, or as the start of one of its tags
 * ("gla" finds glassy); a word written `#warm` matches tags only, so a tag search isn't tripped up by
 * a name that happens to hold the word. A word that matches nothing as typed is read as the term most
 * like it among what's listed (a tag, or a word of a name; a tag, for `#word`), by tagMatch's spelling
 * similarity, and the search says so: "glasy" finds glassy, "nimbs" finds Nimbus. Trigrams forgive
 * a letter missing, added or wrong, not two swapped ("vrese" shares too little with verse).
 */
import { nearestTags } from "./tagMatch";

/** What a search reads: a name, tags, and a description if there is one. */
export interface Searchable {
  name: string;
  tags: readonly string[];
  description?: string;
}

export interface SearchResult<Item> {
  items: Item[];
  /** Words read as another term, and which: `{ glasy: "glassy" }`. */
  readAs?: Record<string, string>;
}

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Whether `word` (lower case, maybe `#`-led) matches `item` as typed. */
function matches(item: Searchable, word: string): boolean {
  const tagStarts = (start: string) => item.tags.some((tag) => tag.toLowerCase().startsWith(start));
  if (word.startsWith("#")) return tagStarts(word.slice(1));
  return (
    item.name.toLowerCase().includes(word) ||
    (item.description?.toLowerCase().includes(word) ?? false) ||
    tagStarts(word)
  );
}

/** `word` as the term most like it among `items`, keeping its `#`; itself if none is like it. */
function nearest(items: readonly Searchable[], word: string): string {
  const tagOnly = word.startsWith("#");
  const bare = tagOnly ? word.slice(1) : word;
  const terms = new Set(items.flatMap((item) => [...item.tags, ...(tagOnly ? [] : wordsOf(item.name))]));
  const found = nearestTags(bare, terms)[0]?.toLowerCase();
  return found === undefined ? word : tagOnly ? `#${found}` : found;
}

/** The items every word of `query` matches, in their order, and what any misspelt word was read as. */
export function search<Item extends Searchable>(items: readonly Item[], query: string): SearchResult<Item> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const read = words.map((word) => (items.some((item) => matches(item, word)) ? word : nearest(items, word)));
  const readAs = Object.fromEntries(
    words.flatMap((word, index) => (read[index] !== word ? [[word, read[index]]] : [])),
  );
  return {
    items: items.filter((item) => read.every((word) => matches(item, word))),
    ...(Object.keys(readAs).length ? { readAs } : {}),
  };
}
