/**
 * The patch library as the MCP tools see it: summaries, one patch in full, and the edit that makes a
 * track from one. Shared by the browser bridge and the hosted MCP server (AGENT-28), so both answer
 * `list_patches` / `get_patch` / `apply_patch` the same way. Pure: user patches come from whatever
 * `allPatches` can reach, which on the server is the factory bank alone.
 */
import type { EditCommand } from "../commands/types";
import { newTrackId } from "../commands/ids";
import type { Author } from "../commands/types";
import type { InstrumentTrack } from "../project/projectStore";
import { keepDevice } from "../library/devices";
import { soundChains, soundDevicesOf, type DeviceSource } from "./sound";
import { newPatchId, savePatch, type Patch } from "./library";
import { allPatches, findPatch } from "./factory";
import { patchesByTags, patchSummary } from "./byTags";

/** list_patches' text, shared by the MCP servers and the in-app agent. */
export const LIST_PATCHES_DOC =
  "List the instrument patches (presets): id, name, author, instrument, tags, effect types, and `builtin` (a " +
  "shipped factory preset, or the user's own). Patches are shared across projects; get_patch gives one in full. " +
  '`tags` looks sounds up by what they\'re like: give tags ("warm", "glassy", "bass") and get the patches ' +
  "carrying them, best match first, as starting points, plus each instrument whose default settings carry them. " +
  "A word that isn't a tag comes back with the tags there are: pick the nearest and ask again.";

/** save_patch's text, shared by the MCP servers and the in-app agent. */
export const SAVE_PATCH_DOC =
  "Save an instrument track's sound (instrument, params, MIDI-device and effect chains) as a patch in the " +
  "user's library, usable in any project. Defaults to the selected track. `tags` say what it sounds like, its " +
  'role first then its character ("pad", "dark", "eerie"); `description` says why it exists (the brief, the ' +
  "song, the part it was made for), not how it sounds, so the two don't contradict. `patch` names one of the " +
  "user's patches to save a new version of instead (its earlier versions are kept); tags and description carry " +
  "over unless given.";

/** What save_patch takes, besides the track. */
export interface SaveOptions {
  name?: string;
  tags?: string[];
  description?: string;
  /** One of the user's patches (id or name) to save a new version of. */
  patch?: string;
}

/**
 * Save a track's sound to the library, as a new patch or a new version of one of the user's. Its
 * custom devices go with it, and into the library on their own (COMM-1.11.1).
 */
export async function savePatchFromTrack(
  track: InstrumentTrack,
  author: Author,
  project: DeviceSource,
  options: SaveOptions = {},
): Promise<Patch> {
  const over = options.patch ? requirePatch(options.patch) : undefined;
  if (over?.builtin) throw new Error(`"${over.name}" is built in, so it can't be saved over. Save a new patch.`);
  const devices = soundDevicesOf(track, project);
  await Promise.all([
    ...(devices?.instruments ?? []).map((device) => keepDevice("instrument", device, author)),
    ...(devices?.effects ?? []).map((device) => keepDevice("effect", device, author)),
  ]);
  return savePatch({
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
  });
}

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
): Extract<EditCommand, { type: "createTrackFromPatch" }> => {
  const patch = requirePatch(query);
  return {
    type: "createTrackFromPatch",
    id: newTrackId(),
    ...soundChains(patch),
    name: name?.trim() || patch.name,
  };
};
