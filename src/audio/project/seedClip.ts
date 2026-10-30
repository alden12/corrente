/**
 * The id of the clip a new track is created holding. Derived rather than minted so a replay makes
 * the same one, and so the authorship stamp for a created track can name it (DAW-8.10).
 */
export const seedClipId = (trackId: string): string => `c-${trackId}`;

/** The id of the seed clip's placement, whether a new track places it at once or its first notes do (DAW-50). */
export const starterPlacementId = (trackId: string): string => `p-${trackId}`;

/**
 * Clips are named "Clip 1", "Clip 2"... within their track (2026-10-13, Alden), replacing "A", "B".
 * A new clip takes the lowest number the track's clips don't already use; clips named otherwise
 * (including older projects' letters) are left alone and simply don't count.
 */
export const FIRST_CLIP_NAME = "Clip 1";

export function nextClipName(used: readonly string[]): string {
  const taken = new Set(used);
  let number = 1;
  while (taken.has(`Clip ${number}`)) number++;
  return `Clip ${number}`;
}
