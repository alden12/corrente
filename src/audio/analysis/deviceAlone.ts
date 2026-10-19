/**
 * One track's sound on its own (AGENT-4.6): the project cut down to that track, so the render core
 * plays just its devices. What `analyze_device` hears, on either MCP server and in the app.
 *
 * It keeps the track's MIDI devices, instrument and effects (up to `through`, to hear part of the
 * chain), and drops everything around it: the other tracks, its groups' effects, and the mixer's
 * volume, mute and solo, since those are the mix rather than the sound. It plays either the track's
 * own notes or a phrase for its role (phrases.ts), at the project's tempo.
 */
import type { ProjectData, TrackData } from "../project/types";
import { PHRASE_BEATS, PHRASES, phraseNotes, type PhraseName } from "./phrases";

export interface DeviceAnalysisRequest {
  /** The track's id. */
  track: string;
  /** Hear the chain up to and including this effect (its id), or `"instrument"` for the instrument alone. */
  through?: string;
  /** Its own notes (`"track"`), or a phrase for its role. Its own notes if it has any, otherwise chords. */
  play?: "track" | PhraseName;
  /** Add a spectrogram picture. */
  picture?: boolean;
}

/** A request that names something the project doesn't have. */
export class DeviceAloneError extends Error {}

/** The most of a track's own notes heard: eight bars of 4/4 from the region's start. */
const MAX_TRACK_BEATS = 32;
const PHRASE_ID = "phrase";

/** The track's chain up to `through`. */
function chainThrough(track: TrackData, through: string | undefined): Pick<TrackData, "effects"> {
  const effects = track.effects ?? [];
  if (through === undefined) return { effects };
  if (through === "instrument" && track.kind === "instrument") return { effects: [] };
  const index = effects.findIndex((effect) => effect.id === through);
  if (index < 0) {
    const ids = effects.map((effect) => `${effect.id} (${effect.type})`).join(", ") || "none";
    throw new DeviceAloneError(`"${through}" isn't an effect on track "${track.name}". Its effects: ${ids}.`);
  }
  return { effects: effects.slice(0, index + 1) };
}

/** The region it plays, and for a phrase, the clip that replaces its own. */
function notesFor(project: ProjectData, track: TrackData, play: DeviceAnalysisRequest["play"]) {
  const own = play === "track" || (play === undefined && (track.placements?.length ?? 0) > 0);
  if (own) {
    const loopStart = project.loopStart ?? 0;
    const lengthBeats = Math.min(project.lengthBeats, loopStart + MAX_TRACK_BEATS);
    const cut = lengthBeats < project.lengthBeats ? `, the first ${MAX_TRACK_BEATS} beats of the region` : "";
    return { region: { loopStart, lengthBeats }, played: `its own notes${cut}` };
  }
  if (track.kind !== "instrument")
    throw new DeviceAloneError(`Track "${track.name}" is an audio track, so it can only play its own clips.`);
  const phrase = play ?? "chords";
  return {
    region: { loopStart: 0, lengthBeats: PHRASE_BEATS, grooveAmount: 0 },
    played: `the ${phrase} phrase: ${PHRASES[phrase].says}`,
    clip: {
      clips: [{ id: PHRASE_ID, name: phrase, author: "you", notes: phraseNotes(phrase), lengthBeats: PHRASE_BEATS }],
      placements: [{ id: PHRASE_ID, clipId: PHRASE_ID, startBeat: 0, offset: 0, length: PHRASE_BEATS }],
      activeClipId: PHRASE_ID,
      launchedClipId: null,
    },
  };
}

/** The project with only `request.track`'s sound left in it, ready to render, and what it plays. */
export function deviceAlone(
  project: ProjectData,
  request: DeviceAnalysisRequest,
): { project: ProjectData; played: string } {
  const track = project.tracks.find((candidate) => candidate.id === request.track);
  if (!track) throw new DeviceAloneError(`No track "${request.track}" in this project (list_tracks gives the ids).`);
  const { region, clip, played } = notesFor(project, track, request.play);

  // Its groups stay, so it's routed as it is, but as plain buses at unity.
  const groupsById = new Map(project.groups.map((group) => [group.id, group]));
  const ancestors = (parentId: string | null): ProjectData["groups"] => {
    const group = parentId === null ? undefined : groupsById.get(parentId);
    return group ? [...ancestors(group.parentId), group] : [];
  };
  const alone: ProjectData = {
    ...project,
    ...region,
    groups: ancestors(track.parentId).map((group) => ({ ...group, effects: [], muted: false, solo: false, volume: 1 })),
    tracks: [
      { ...track, ...chainThrough(track, request.through), ...clip, muted: false, solo: false, volume: 1 } as TrackData,
    ],
    selectedTrackId: track.id,
  };
  return { project: alone, played };
}
