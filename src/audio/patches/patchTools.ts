/**
 * The patch library as the MCP tools see it: summaries, one patch in full, and the edit that makes a
 * track from one. Shared by the browser bridge and the hosted MCP server (AGENT-28), so both answer
 * `list_patches` / `get_patch` / `apply_patch` the same way. The user's own patches (`mine`) are an
 * argument, never read here: this device's library in the tab, what the hosted server read from
 * their account (COMM-1.11.2). The tools' docs and arguments are toolSpec.ts.
 */
import type { EditCommand } from "../commands/types";
import { newTrackId } from "../commands/ids";
import type { Author } from "../commands/types";
import type { InstrumentTrack, ProjectStore } from "../project/projectStore";
import { soundChains, soundDevicesOf, type DeviceSource } from "./sound";
import { newPatchId, type Patch } from "./patch";
import { pageOf, type PatchListing, type SaveOptions } from "./toolSpec";
import { allPatches, findPatch } from "./factory";
import { patchesByTags, patchSummary } from "./byTags";
import { search } from "../search";

/**
 * A track's sound as a patch: a new one, or the next version of one of the user's (`mine`). Its
 * custom devices go with it. Built, not saved: the tab saves it to the library on the device
 * (`savePatchFromTrack`), the hosted server to the account.
 */
export function patchFromTrack(
  track: InstrumentTrack,
  author: Author,
  project: DeviceSource,
  mine: readonly Patch[],
  options: SaveOptions = {},
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

/** The instrument track save_patch means: the one named, else the selected one. */
export function trackToSave(project: ProjectStore, trackId?: string): InstrumentTrack {
  const id = trackId ?? project.selectedId ?? undefined;
  const track = id ? project.getTrack(id) : undefined;
  if (!track) throw new Error("No track specified and none selected.");
  if (track.kind !== "instrument")
    throw new Error(`Track ${track.id} is an audio track; patches need an instrument track.`);
  return track;
}

/**
 * list_patches: a page of every patch, or of those matching `tags`, or of the user's own (`mine`).
 * Summaries only: get_patch has one in full.
 */
export function listPatchesFor(listing: PatchListing, mine: readonly Patch[]) {
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

const requirePatch = (query: string, mine: readonly Patch[]) => {
  const patch = findPatch(query.trim(), mine);
  if (!patch) throw new Error(`No patch matching "${query.trim()}". Use list_patches.`);
  return patch;
};

/** Full specifics of one patch (param values + per-device params), searched by id or name. */
export const patchDetails = (query: string, mine: readonly Patch[]) => {
  const patch = requirePatch(query, mine);
  return {
    ...patchSummary(patch),
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
  mine: readonly Patch[],
  name?: string,
): Extract<EditCommand, { type: "createTrackFromPatch" }> => {
  const patch = requirePatch(query, mine);
  return {
    type: "createTrackFromPatch",
    id: newTrackId(),
    ...soundChains(patch),
    name: name?.trim() || patch.name,
  };
};
