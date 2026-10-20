/**
 * Part of the mix (AGENT-4.4): some of its tracks, a window of the song, or both, so a question about
 * a big project renders only what it needs ("is the bass clipping?", "how do beats 128-192 sound?").
 * What `analyze_mix` hears when it's narrowed, on either MCP server and in the app.
 *
 * - **Tracks stay where they sit in the mix**, through their groups' effects and faders, unlike
 *   analyze_device's sound alone. The other tracks go, and the groups left with nothing in them.
 *   Asking for a track means wanting to hear it, so mute and solo are set aside.
 * - **A window starts mid-song, so it plays in from before it.** The render starts a few seconds
 *   early, or earlier still to catch a note already held at the window's start (up to a limit), so
 *   held notes and the tails of effects are there from its first beat; that pre-roll is played but not
 *   kept or measured (`skipSec`). It ends at the window's end, with the usual tail only when that is the
 *   song's end.
 */
import type { GroupData, ProjectData, TrackData } from "../project/types";
import type { ProjectRenderOptions } from "../render/renderProject";
import { beatsToSeconds, tileClipNotes } from "../sequencer/timing";

export interface MixAnalysisRequest {
  /** Track ids to hear; every track when absent. */
  tracks?: string[];
  /** The window, in beats like a note's start; the arrangement's region when absent. */
  from?: number;
  to?: number;
  /** Add a spectrogram picture. */
  picture?: boolean;
}

/** A request that names something the project doesn't have. */
export class MixScopeError extends Error {}

/** The pre-roll that lets reverbs and delays ring into the window. */
const PRE_ROLL_SEC = 4;
/** The most pre-roll a held note may ask for, so one long drone doesn't render the song before it. */
const MAX_PRE_ROLL_SEC = 16;

/** Where the earliest note still sounding at `beat` started, on the tracks kept. */
function earliestHeldAt(tracks: TrackData[], beat: number): number {
  return tracks
    .flatMap((track) => {
      if (track.kind !== "instrument") return [];
      return (track.placements ?? []).flatMap((placement) => {
        const clip = (track.clips ?? []).find((candidate) => candidate.id === placement.clipId);
        if (!clip) return [];
        return tileClipNotes(clip.notes, clip.lengthBeats, placement.offset, placement.length)
          .map((note) => ({
            start: placement.startBeat + note.start,
            end: placement.startBeat + note.start + note.length,
          }))
          .filter(({ start, end }) => start < beat && end > beat)
          .map(({ start }) => start);
      });
    })
    .reduce((earliest, start) => Math.min(earliest, start), beat);
}

/** The tracks asked for, and the groups they're routed through. */
function onlyTracks(project: ProjectData, ids: string[]): Pick<ProjectData, "tracks" | "groups"> {
  const missing = ids.filter((id) => !project.tracks.some((track) => track.id === id));
  if (missing.length)
    throw new MixScopeError(
      `No track ${missing.map((id) => `"${id}"`).join(", ")} in this project (list_tracks gives the ids).`,
    );
  const tracks = project.tracks
    .filter((track) => ids.includes(track.id))
    .map((track) => ({ ...track, muted: false, solo: false }) as TrackData);
  const groupsById = new Map(project.groups.map((group) => [group.id, group]));
  const ancestors = (parentId: string | null): GroupData[] => {
    const group = parentId === null ? undefined : groupsById.get(parentId);
    return group ? [group, ...ancestors(group.parentId)] : [];
  };
  const kept = new Set(tracks.flatMap((track) => ancestors(track.parentId)).map((group) => group.id));
  return {
    tracks,
    groups: project.groups
      .filter((group) => kept.has(group.id))
      .map((group) => ({ ...group, muted: false, solo: false })),
  };
}

/** The window's beats, checked against the region. */
function windowOf(project: ProjectData, { from, to }: MixAnalysisRequest) {
  const regionStart = project.loopStart ?? 0;
  const regionEnd = project.lengthBeats;
  const window = { from: from ?? regionStart, to: to ?? regionEnd };
  if (window.from < regionStart || window.to > regionEnd || window.from >= window.to)
    throw new MixScopeError(
      `Beats ${window.from}-${window.to} aren't a window of the arrangement, which runs from beat ${regionStart} to ${regionEnd}.`,
    );
  return { ...window, regionStart, regionEnd };
}

/**
 * The project cut down to `request`'s tracks and window, ready to render with `options`, and a line
 * saying what it heard.
 */
export function mixScope(
  project: ProjectData,
  request: MixAnalysisRequest,
): { project: ProjectData; options: ProjectRenderOptions; heard: string } {
  const scoped = request.tracks?.length ? { ...project, ...onlyTracks(project, request.tracks) } : project;
  const { from, to, regionStart, regionEnd } = windowOf(project, request);
  const beatsPerSecond = project.tempoBpm / 60;
  const preRoll = Math.min(
    Math.max(PRE_ROLL_SEC * beatsPerSecond, from - earliestHeldAt(scoped.tracks, from)),
    MAX_PRE_ROLL_SEC * beatsPerSecond,
  );
  const renderFrom = Math.max(regionStart, from - preRoll);

  const names = request.tracks?.length ? scoped.tracks.map((track) => `"${track.name}"`).join(", ") : "every track";
  const whole = from === regionStart && to === regionEnd;
  return {
    project: { ...scoped, loopStart: renderFrom, lengthBeats: to },
    options: {
      skipSec: beatsToSeconds(from - renderFrom, project.tempoBpm),
      ...(to < regionEnd ? { tailSec: 0 } : {}),
    },
    heard: `${names}, ${whole ? "the whole arrangement" : `beats ${from} to ${to}`}`,
  };
}
