/** Whether a name has every word of a filter in it, in any order: the Projects and Tracks filters. */
export const nameMatches = (name: string, filter: string) =>
  filter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => name.toLowerCase().includes(word));
