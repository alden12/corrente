/**
 * The patch library as the MCP tools see it: summaries, one patch in full, and the edit that makes a
 * track from one. Shared by the browser bridge and the hosted MCP server (AGENT-28), so both answer
 * `list_patches` / `get_patch` / `apply_patch` the same way. Pure: user patches come from whatever
 * `allPatches` can reach, which on the server is the factory bank alone.
 */
import type { EditCommand } from "../commands/types";
import { newTrackId } from "../commands/ids";
import { soundChains } from "./sound";
import { allPatches, findPatch } from "./factory";
import { patchesByTags, patchSummary } from "./byTags";

/** list_patches' text, shared by the MCP servers and the in-app agent. */
export const LIST_PATCHES_DOC =
  "List the instrument patches (presets): id, name, author, instrument, tags, effect types, and `builtin` (a " +
  "shipped factory preset, or the user's own). Patches are shared across projects; get_patch gives one in full. " +
  '`tags` looks sounds up by what they\'re like: give a brief\'s words ("warm", "eerie", "supersaw") and get ' +
  "the patches carrying them, best match first, as starting points, plus each instrument whose default settings " +
  "carry them. A tag can come with a note (how to build it on the engine's blocks) and a check (what " +
  "analyze_device shows when it worked): follow the note when designing, and confirm the check after. A word " +
  "it doesn't know comes back with the tags it does.";

/** list_patches: every patch, or those matching `tags`. */
export const listPatchesFor = ({ tags }: { tags?: unknown }) =>
  Array.isArray(tags) && tags.length ? patchesByTags(tags.map(String)) : allPatches().map(patchSummary);

const requirePatch = (query: string) => {
  const patch = findPatch(query.trim());
  if (!patch) throw new Error(`No patch matching "${query.trim()}". Use list_patches.`);
  return patch;
};

/** Full specifics of one patch (param values + per-device params), searched by id or name. */
export const patchDetails = (query: string) => {
  const patch = requirePatch(query);
  return {
    id: patch.id,
    name: patch.name,
    author: patch.author,
    instrument: patch.instrumentType,
    builtin: patch.builtin ?? false,
    tags: patch.tags ?? [],
    params: patch.params,
    midiDevices: (patch.midiDevices ?? []).map((device) => ({
      type: device.type,
      bypassed: device.bypassed ?? false,
      params: device.params,
    })),
    effects: patch.effects.map((effect) => ({
      type: effect.type,
      bypassed: effect.bypassed ?? false,
      params: effect.params,
    })),
  };
};

/** The edit that creates a track from a patch. Ids are minted here and carried, so it replays exactly. */
export const patchTrackCommand = (
  query: string,
  name?: string,
): Extract<EditCommand, { type: "createTrackFromPatch" }> => {
  const patch = requirePatch(query);
  return {
    type: "createTrackFromPatch",
    id: newTrackId(),
    ...soundChains(patch),
    name: name?.trim() || patch.name,
  };
};
