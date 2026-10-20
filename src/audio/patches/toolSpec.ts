/**
 * What the patch tools are, to the agents: their descriptions and arguments, one definition for the
 * MCP servers and the in-app agent (patchTools.ts does what they say), and how list_patches pages.
 * Pure, so both MCP servers take it without the device's library.
 */
import { z } from "zod";

/** list_patches' text, shared by the MCP servers and the in-app agent. */
export const LIST_PATCHES_DOC =
  "List the instrument patches (presets): id, name, author, instrument, tags, effect types, and `builtin` (a " +
  "shipped factory preset, or the user's own). Patches are shared across projects; get_patch gives one in full. " +
  '`tags` looks sounds up by what they\'re like: give tags ("warm", "glassy", "bass") and get the patches ' +
  "carrying them, best match first, as starting points, plus each instrument whose default settings carry them. " +
  "A misspelt tag is read as the nearest (`readAs` says so); a word like no tag comes back with the most used " +
  "tags: pick the nearest in meaning and ask again. `query` finds words in a patch's name, description or tags, " +
  "forgiving spelling: how to find one the user made. `mine` lists only the user's own patches. A page at a time " +
  "(`limit`, default 50): pass `next` back as `cursor` for the rest.";

/** save_patch's text, shared by the MCP servers and the in-app agent. */
export const SAVE_PATCH_DOC =
  "Save an instrument track's sound (instrument, params, MIDI-device and effect chains) as a patch in the " +
  "user's library, usable in any project. Defaults to the selected track. `tags` say what it sounds like, its " +
  'role first then its character ("pad", "dark", "eerie"); `description` says why it exists (the brief, the ' +
  "song, the part it was made for), not how it sounds, so the two don't contradict. `patch` names one of the " +
  "user's patches to save a new version of instead (its earlier versions are kept); tags and description carry " +
  "over unless given.";

/** get_patch's and apply_patch's text, shared by the MCP servers and the in-app agent. */
export const GET_PATCH_DOC =
  "Get the full specifics of one patch (by name or id from list_patches): its instrument, every parameter value, " +
  "and its effect chain with per-effect params. Works for both factory and user patches - useful for inspecting a " +
  "sound or promoting a user patch into the factory bank.";
export const APPLY_PATCH_DOC =
  "Add a new instrument track from a patch - factory or user (by name or id from list_patches). One undoable " +
  "edit; the track files into the main group.";

/** A page of list_patches: how many by default, and at most. */
export const PATCH_PAGE = 50;
export const MAX_PATCH_PAGE = 100;

const patchArg = z.string().min(1).describe("patch name or id (from list_patches)");

/**
 * The patch tools' arguments, one definition for the MCP servers (an input schema's shape) and the
 * in-app agent (`z.object` of it), so the two can't drift.
 */
export const PATCH_TOOL_ARGS = {
  list_patches: {
    tags: z.array(z.string()).optional().describe("words for the sound wanted; every patch when absent"),
    query: z.string().optional().describe("words in a patch's name, description or tags, spelling forgiven"),
    mine: z.boolean().optional().describe("only the user's own patches"),
    limit: z.number().int().min(1).max(MAX_PATCH_PAGE).optional(),
    cursor: z.string().optional().describe("the last page's `next`"),
  },
  get_patch: { patch: patchArg },
  apply_patch: {
    patch: patchArg,
    name: z.string().optional().describe("name for the new track (default: the patch name)"),
  },
  save_patch: {
    name: z.string().min(1).max(60).optional().describe("its name (default: the track's, or the patch's)"),
    track: z.string().optional().describe("instrument track id (default: the selected track)"),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
    description: z.string().max(500).optional(),
    patch: z.string().optional().describe("one of the user's patches (id or name) to save a new version of"),
  },
} satisfies Record<string, z.ZodRawShape>;

/** What save_patch takes, besides the track. */
export interface SaveOptions {
  name?: string;
  tags?: string[];
  description?: string;
  /** One of the user's patches (id or name) to save a new version of. */
  patch?: string;
}

/** What list_patches takes. */
export interface PatchListing {
  tags?: unknown;
  /** Words to find in a patch's name, description or tags (search.ts). */
  query?: unknown;
  /** Only the user's own patches. */
  mine?: unknown;
  limit?: unknown;
  /** Where the last page left off: its `next`. */
  cursor?: unknown;
}

/** Where a page starts and how long it is, from a listing's `cursor` and `limit`. */
export const pageBounds = ({ limit, cursor }: PatchListing) => ({
  size: Math.min(Math.max(Math.trunc(Number(limit)) || PATCH_PAGE, 1), MAX_PATCH_PAGE),
  from: Math.max(Math.trunc(Number(cursor)) || 0, 0),
});

/** One page of `entries`, and the cursor to the next if there's more. */
export function pageOf<Entry>(entries: readonly Entry[], listing: PatchListing) {
  const { size, from } = pageBounds(listing);
  return {
    patches: entries.slice(from, from + size),
    ...(from + size < entries.length ? { next: String(from + size) } : {}),
  };
}
