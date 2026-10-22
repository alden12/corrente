/**
 * What a new project starts with (DAW-76): one track on the Micro VA's Classic Lead, the best first
 * sound the app has, rather than a bare default instrument. The very first project on a device (or
 * in a new account) also gets a few notes in its clip, so the first Play makes music.
 *
 * DOM-free and deterministic apart from the ids the store makes, so the browser and the local MCP's
 * mirror seed the same way.
 */
import { FACTORY_PATCHES } from "../patches/factory";
import { PORTRAIT_KEYS } from "../portraits/keys";
import type { NoteInput } from "../sequencer/clipStore";
import { randomUuid } from "../randomUuid";
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

/**
 * The opening of Strauss's *Also sprach Zarathustra* (1896, long out of copyright), the 2001 theme:
 * C, G, C stacked over four bars and held, a build that never resolves, so it asks for more.
 * [pitch, start beat, length in beats, velocity].
 */
const MELODY: readonly (readonly [number, number, number, number])[] = [
  [48, 0, 14, 0.8],
  [55, 4, 10, 0.85],
  [60, 8, 6, 0.85],
];

export const STARTER_MELODY: readonly NoteInput[] = MELODY.map(([pitch, start, length, velocity]) => ({
  pitch,
  start,
  length,
  velocity,
}));

export const STARTER_CLIP_NAME = "Sunrise";

/**
 * Put the example melody in the first track's clip, named so it reads as an example. Only into an
 * empty clip, so running it twice (boot runs twice under StrictMode) adds it once.
 */
export function addStarterMelody(project: ProjectStore): void {
  const track = project.getTracks().find((candidate) => candidate.kind === "instrument");
  const clip = track && project.getClipStore(track.id);
  if (track?.kind !== "instrument" || !clip || clip.getClip().notes.length > 0) return;
  // In one change, so the roll sees a clip arrive rather than notes drawn one at a time.
  clip.load({ notes: STARTER_MELODY.map((note) => ({ length: 1, velocity: 0.8, ...note, id: randomUuid() })) });
  project.renameClip(track.id, track.activeClipId, STARTER_CLIP_NAME);
}
