/**
 * What a new project starts with (DAW-76): one track on the Micro VA's Classic Lead, the best first
 * sound the app has, rather than a bare default instrument. The very first project on a device (or
 * in a new account) also gets a short melody in its clip, so the first Play makes music.
 *
 * DOM-free and deterministic apart from the ids the store makes, so the browser and the local MCP's
 * mirror seed the same way.
 */
import { FACTORY_PATCHES } from "../patches/factory";
import type { NoteInput } from "../sequencer/clipStore";
import type { ProjectStore, Track } from "./projectStore";

export const STARTER_PATCH_ID = "factory:micro-va:classic-lead";

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
 * Four bars in A minor at the default tempo, A3 to A4 so it sits in the piano roll's opening view:
 * [pitch, start beat, length in beats, velocity].
 */
const MELODY: readonly (readonly [number, number, number, number])[] = [
  [57, 0, 0.5, 0.9],
  [60, 0.5, 0.5, 0.75],
  [64, 1, 1, 0.85],
  [62, 2, 0.5, 0.8],
  [60, 2.5, 0.5, 0.75],
  [62, 3, 1, 0.8],
  [64, 4, 1.5, 0.9],
  [67, 5.5, 0.5, 0.8],
  [64, 6, 1, 0.85],
  [62, 7, 1, 0.75],
  [60, 8, 0.5, 0.9],
  [62, 8.5, 0.5, 0.75],
  [64, 9, 1, 0.85],
  [69, 10, 1, 0.95],
  [67, 11, 1, 0.8],
  [64, 12, 1, 0.9],
  [62, 13, 0.5, 0.75],
  [60, 13.5, 0.5, 0.75],
  [57, 14, 2, 0.85],
];

export const STARTER_MELODY: readonly NoteInput[] = MELODY.map(([pitch, start, length, velocity]) => ({
  pitch,
  start,
  length,
  velocity,
}));

export const STARTER_CLIP_NAME = "Example melody";

/**
 * Put the example melody in the first track's clip, named so it reads as an example. Only into an
 * empty clip, so running it twice (boot runs twice under StrictMode) adds it once.
 */
export function addStarterMelody(project: ProjectStore): void {
  const track = project.getTracks().find((candidate) => candidate.kind === "instrument");
  const clip = track && project.getClipStore(track.id);
  if (track?.kind !== "instrument" || !clip || clip.getClip().notes.length > 0) return;
  STARTER_MELODY.forEach((note) => clip.addNote(note));
  project.renameClip(track.id, track.activeClipId, STARTER_CLIP_NAME);
}
