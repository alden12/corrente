/**
 * Each person's preview (COMM-1.4.5): the sound they're trying from Explore, as an instrument track
 * of the project, one per user id. It lives in the project's `previews`, beside its tracks rather
 * than among them, so whatever looks a track up by id finds it (the rack, a tab, undo, the device
 * edits) and whatever lists the tracks (the arrangement, the mixer, export) doesn't. Keyed by user
 * id rather than name: names change, and two people can share one.
 */
const PREFIX = "preview:";

/** The id of `owner`'s preview track. */
export const previewTrackId = (owner: string): string => `${PREFIX}${owner}`;

/** Whether a track id is a preview's. */
export const isPreviewTrackId = (id: string): boolean => id.startsWith(PREFIX);
