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
import { randomUuid } from "../randomUuid";
import { builtinRef } from "../samples/catalog";
import {
  MORNING_BEATS,
  MORNING_CHORDS,
  MORNING_DRUMS,
  MORNING_LEAD,
  MORNING_PAD,
  MORNING_SECTION,
  MORNING_TEMPO,
  type SongClip,
} from "./morningSong";
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
export function addStarterTrack(project: ProjectStore, opts: { name?: string; unplaced?: boolean } = {}): Track {
  const patch = starterPatch();
  const track = project.addTrack(patch.instrumentType, opts);
  if (track.kind !== "instrument") return track;
  track.params.load(patch.params);
  for (const patchEffect of patch.effects)
    project.addEffect(track.id, patchEffect.type)?.params.load(patchEffect.params);
  return track;
}

/**
 * A part's clips into its track, each a section long and placed at its sections. The track's own
 * empty clip takes the first, so a part adds no clip it doesn't play; the first is left active.
 */
function fillPart(project: ProjectStore, track: Track, clips: readonly SongClip[]): void {
  if (track.kind !== "instrument") return;
  const seedId = track.activeClipId;
  [...track.placements].forEach((placement) => project.removePlacement(track.id, placement.id));
  clips.forEach((songClip, index) => {
    const clipId = index === 0 ? seedId : project.addClip(track.id, { empty: true })?.id;
    if (!clipId) return;
    // In one change, so the roll sees a clip arrive rather than notes drawn one at a time.
    project.getClipStore(track.id, clipId)?.load({
      lengthBeats: MORNING_SECTION,
      notes: songClip.notes.map((note) => ({ length: 1, velocity: 0.8, ...note, id: randomUuid() })),
    });
    project.renameClip(track.id, clipId, songClip.name);
    songClip.at.forEach((startBeat) => project.addPlacement(track.id, { clipId, startBeat, length: MORNING_SECTION }));
  });
  project.selectClip(track.id, seedId);
}

/**
 * The first project plays the Morning Song (DAW-94), as Alden arranged it: the starter track takes
 * the chords, a Sampler on the pitched 808 kick plays the timpani, a Pad holds the bass, and a second
 * Micro VA the lead. Only while the starter track's clip is empty, so running it twice (boot runs
 * twice under StrictMode) adds it once.
 */
export function addStarterSong(project: ProjectStore): void {
  const chords = project.getTracks().find((candidate) => candidate.kind === "instrument");
  const clip = chords && project.getClipStore(chords.id);
  if (chords?.kind !== "instrument" || !clip || clip.getClip().notes.length > 0) return;
  project.setTempo(MORNING_TEMPO);
  project.setLength(MORNING_BEATS);
  project.renameTrack(chords.id, "Chords");
  const drums = project.addTrack("sampler", { name: "Drums", unplaced: true });
  if (drums.kind === "instrument") drums.params.set("sampler.sample", builtinRef("808-kick"));
  project.addEffect(drums.id, "reverb")?.params.load({ "reverb.decay": 2, mix: 0.3 });
  project.setVolume(drums.id, 0.42);
  const pad = project.addTrack("pad", { name: "Pad", unplaced: true });
  project.addMidiDevice(pad.id, "octavator")?.params.load({ octaveUp: true, octaveDown: true, level: 0.41 });
  const lead = addStarterTrack(project, { name: "Lead", unplaced: true });
  project.setVolume(lead.id, 0.6);
  (
    [
      [chords, MORNING_CHORDS],
      [drums, MORNING_DRUMS],
      [pad, MORNING_PAD],
      [lead, MORNING_LEAD],
    ] as const
  ).forEach(([track, clips]) => fillPart(project, track, clips));
  // The chords stay the track you land on.
  project.selectTrack(chords.id);
}
