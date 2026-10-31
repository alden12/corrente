/**
 * What a new project starts with (DAW-76): one track on the Micro VA's Classic Lead, the best first
 * sound the app has, rather than a bare default instrument. The very first project on a device (or
 * in a new account) also plays the Morning Song (DAW-94), so the first Play makes music.
 *
 * DOM-free and deterministic apart from the ids the store makes, so the browser and the local MCP's
 * mirror seed the same way.
 */
import { FACTORY_PATCHES } from "../patches/factory";
import { PORTRAIT_KEYS } from "../portraits/keys";
import type { NoteInput } from "../sequencer/clipStore";
import { randomUuid } from "../randomUuid";
import { builtinRef } from "../samples/catalog";
import { MORNING_BEATS, MORNING_LEAD, MORNING_PAD, MORNING_TEMPO, MORNING_TIMPANI } from "./morningSong";
import type { ProjectStore, Track } from "./projectStore";

export const STARTER_PATCH_ID = "factory:micro-va:classic-lead";

/** What the starter plays, as Explore keys, oldest first: the patch ends up first on Recently used. */
export const STARTER_RECENT_KEYS = [PORTRAIT_KEYS.instrument("micro-va"), PORTRAIT_KEYS.patch(STARTER_PATCH_ID)];

const starterPatch = () => {
  const patch = FACTORY_PATCHES.find((candidate) => candidate.id === STARTER_PATCH_ID);
  if (!patch) throw new Error(`The starter patch ${STARTER_PATCH_ID} is missing from the factory patches`);
  return patch;
};

/** Add the starter track: the patch's instrument, its values, and its effects. */
export function addStarterTrack(project: ProjectStore): Track {
  const patch = starterPatch();
  const track = project.addTrack(patch.instrumentType);
  if (track.kind !== "instrument") return track;
  track.params.load(patch.params);
  for (const patchEffect of patch.effects)
    project.addEffect(track.id, patchEffect.type)?.params.load(patchEffect.params);
  return track;
}

export const STARTER_CLIP_NAME = "Sunrise";

/** What each track's clip holds, by the track's role in the song. */
type SongPart = { track: Track; notes: readonly NoteInput[] };

/** A part's notes into its track's clip, the clip as long as the song and placed whole. */
function fillPart(project: ProjectStore, { track, notes }: SongPart): void {
  if (track.kind !== "instrument") return;
  const clip = project.getClipStore(track.id);
  // In one change, so the roll sees a clip arrive rather than notes drawn one at a time.
  clip?.load({
    lengthBeats: MORNING_BEATS,
    notes: notes.map((note) => ({ length: 1, velocity: 0.8, ...note, id: randomUuid() })),
  });
  project.renameClip(track.id, track.activeClipId, STARTER_CLIP_NAME);
  track.placements.forEach((placement) => project.resizePlacement(track.id, placement.id, { length: MORNING_BEATS }));
}

/**
 * The first project plays the Morning Song (DAW-94), as Alden arranged it: the starter track takes
 * the lead, a Sampler on the pitched 808 kick plays the timpani, and a Pad holds the low C. Only while
 * the starter track's clip is empty, so running it twice (boot runs twice under StrictMode) adds it once.
 */
export function addStarterSong(project: ProjectStore): void {
  const lead = project.getTracks().find((candidate) => candidate.kind === "instrument");
  const clip = lead && project.getClipStore(lead.id);
  if (lead?.kind !== "instrument" || !clip || clip.getClip().notes.length > 0) return;
  project.setTempo(MORNING_TEMPO);
  project.setLength(MORNING_BEATS);
  // Added after the length is set, so their clips start the song's length.
  const timpani = project.addTrack("sampler");
  if (timpani.kind === "instrument") timpani.params.set("sampler.sample", builtinRef("808-kick"));
  project.addEffect(timpani.id, "reverb")?.params.load({ "reverb.decay": 2, mix: 0.3 });
  project.setVolume(timpani.id, 0.45);
  const pad = project.addTrack("pad");
  project.addMidiDevice(pad.id, "octavator")?.params.load({ octaveUp: true, octaveDown: true, level: 0.41 });
  [
    { track: lead, notes: MORNING_LEAD },
    { track: timpani, notes: MORNING_TIMPANI },
    { track: pad, notes: MORNING_PAD },
  ].forEach((part) => fillPart(project, part));
  // The lead stays the track you land on.
  project.selectTrack(lead.id);
}
