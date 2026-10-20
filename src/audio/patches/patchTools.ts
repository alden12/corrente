/**
 * The patch library as the MCP tools see it: summaries, one patch in full, and the edit that makes a
 * track from one. Shared by the browser bridge and the hosted MCP server (AGENT-28), so both answer
 * `list_patches` / `get_patch` / `apply_patch` the same way. The user's own patches are an argument:
 * this device's library by default, or what the hosted server read from their account (COMM-1.11.2).
 */
import { z } from "zod";
import type { EditCommand } from "../commands/types";
import { newTrackId } from "../commands/ids";
import type { Author } from "../commands/types";
import type { InstrumentTrack, ProjectStore } from "../project/projectStore";
import { keepDevice } from "../library/devices";
import { soundChains, soundDevicesOf, type DeviceSource } from "./sound";
import { listPatches, newPatchId, savePatch, type Patch } from "./library";
import { allPatches, findPatch } from "./factory";
import { patchesByTags, patchSummary } from "./byTags";
import { search } from "../search";

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

/**
 * A track's sound as a patch: a new one, or the next version of one of the user's (`mine`, this
 * device's library by default). Its custom devices go with it. Built, not saved: the tab saves it to
 * the library on the device, the hosted server to the account.
 */
export function patchFromTrack(
  track: InstrumentTrack,
  author: Author,
  project: DeviceSource,
  options: SaveOptions = {},
  mine?: readonly Patch[],
): Patch {
  const over = options.patch ? requirePatch(options.patch, mine) : undefined;
  if (over?.builtin) throw new Error(`"${over.name}" is built in, so it can't be saved over. Save a new patch.`);
  const devices = soundDevicesOf(track, project);
  return {
    ...(devices ? { devices } : {}),
    id: over?.id ?? newPatchId(),
    name: options.name?.trim() || over?.name || track.name,
    author,
    instrumentType: track.instrumentType,
    params: track.params.snapshot(),
    midiDevices: track.midiDevices.map((device) => ({
      type: device.type,
      bypassed: device.bypassed,
      params: device.params.snapshot(),
    })),
    effects: track.effects.map((effect) => ({
      type: effect.type,
      bypassed: effect.bypassed,
      params: effect.params.snapshot(),
    })),
    createdAt: Date.now(),
    tags: options.tags ?? over?.tags ?? [],
    description: options.description ?? over?.description,
  };
}

/**
 * Save a track's sound to the library on this device, as a new patch or a new version of one of the
 * user's. Its custom devices go with it, and into the library on their own (COMM-1.11.1).
 */
export async function savePatchFromTrack(
  track: InstrumentTrack,
  author: Author,
  project: DeviceSource,
  options: SaveOptions = {},
): Promise<Patch> {
  const patch = patchFromTrack(track, author, project, options);
  await Promise.all([
    ...(patch.devices?.instruments ?? []).map((device) => keepDevice("instrument", device, author)),
    ...(patch.devices?.effects ?? []).map((device) => keepDevice("effect", device, author)),
  ]);
  return savePatch(patch);
}

/** The instrument track save_patch means: the one named, else the selected one. */
export function trackToSave(project: ProjectStore, trackId?: string): InstrumentTrack {
  const id = trackId ?? project.selectedId ?? undefined;
  const track = id ? project.getTrack(id) : undefined;
  if (!track) throw new Error("No track specified and none selected.");
  if (track.kind !== "instrument")
    throw new Error(`Track ${track.id} is an audio track; patches need an instrument track.`);
  return track;
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

/**
 * list_patches: a page of every patch, or of those matching `tags`, or of the user's own (`mine`:
 * this device's library by default, as in `allPatches`). Summaries only: get_patch has one in full.
 */
export function listPatchesFor(listing: PatchListing, mine: readonly Patch[] = listPatches()) {
  const own = listing.mine === true;
  const pool = own ? mine : allPatches(mine);
  const words = Array.isArray(listing.tags) ? listing.tags.map(String) : [];
  const found = words.length ? patchesByTags(words, pool, !own) : { patches: pool.map(patchSummary) };
  const query = typeof listing.query === "string" ? listing.query : "";
  const searched = search(found.patches, query);
  const readAs = { ...("readAs" in found ? found.readAs : {}), ...searched.readAs };
  return {
    ...found,
    ...(Object.keys(readAs).length ? { readAs } : {}),
    ...pageOf(searched.items, listing),
  };
}

const requirePatch = (query: string, mine?: readonly Patch[]) => {
  const patch = findPatch(query.trim(), mine);
  if (!patch) throw new Error(`No patch matching "${query.trim()}". Use list_patches.`);
  return patch;
};

/** Full specifics of one patch (param values + per-device params), searched by id or name. */
export const patchDetails = (query: string, mine?: readonly Patch[]) => {
  const patch = requirePatch(query, mine);
  return {
    id: patch.id,
    name: patch.name,
    author: patch.author,
    instrument: patch.instrumentType,
    builtin: patch.builtin ?? false,
    tags: patch.tags ?? [],
    ...(patch.description ? { description: patch.description } : {}),
    ...(patch.version ? { version: patch.version } : {}),
    // Named, not inlined: a definition is long, and list_custom_devices shows one once it's in the project.
    ...(patch.devices
      ? {
          customDevices: [...(patch.devices.instruments ?? []), ...(patch.devices.effects ?? [])].map(
            (device) => device.label ?? device.type,
          ),
        }
      : {}),
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
  mine?: readonly Patch[],
): Extract<EditCommand, { type: "createTrackFromPatch" }> => {
  const patch = requirePatch(query, mine);
  return {
    type: "createTrackFromPatch",
    id: newTrackId(),
    ...soundChains(patch),
    name: name?.trim() || patch.name,
  };
};
