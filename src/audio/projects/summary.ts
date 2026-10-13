/**
 * A project at a glance (MOBILE-19.3): what the Projects list shows without loading the project -
 * its tempo, meter and track count, and its arrangement as lanes of clip spans, which is all a
 * thumbnail draws. Kept with the project's listing (the `projects` row when hosted, `meta.json`
 * locally), so the list is one request however many projects there are.
 *
 * Pure and DOM-free: the server's room computes it from its in-memory head, the local repository
 * from the snapshot it is saving.
 */
import { z } from "zod";
import type { ProjectData } from "../project/types";

/** A thumbnail is a few dozen pixels tall: lanes past this would be under a pixel each. */
export const SUMMARY_MAX_LANES = 12;
/** And a lane of that width has room for only so many blocks. */
export const SUMMARY_MAX_CLIPS = 24;

export const projectSummarySchema = z.object({
  tempoBpm: z.number(),
  /** Beats per bar and the beat unit, as the transport shows them ("3/4"). */
  timeSignature: z.object({ numerator: z.number(), denominator: z.number() }),
  trackCount: z.number(),
  /** How long the arrangement runs, in beats: the project length, or the last clip's end if later. */
  spanBeats: z.number(),
  /** One lane per track, top to bottom (the first `SUMMARY_MAX_LANES`): each clip as `[startBeat, lengthBeats]`. */
  lanes: z.array(z.array(z.tuple([z.number(), z.number()]))),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

const round = (beats: number) => Math.round(beats * 100) / 100;

export function summarizeProject(project: ProjectData): ProjectSummary {
  const lanes = project.tracks.map((track) =>
    (track.placements ?? [])
      .slice()
      .sort((left, right) => left.startBeat - right.startBeat)
      .map((placement): [number, number] => [round(placement.startBeat), round(placement.length)]),
  );
  const lastEnd = Math.max(0, ...lanes.flat().map(([start, length]) => start + length));
  return {
    tempoBpm: project.tempoBpm,
    timeSignature: project.timeSignature ?? { numerator: 4, denominator: 4 },
    trackCount: project.tracks.length,
    spanBeats: Math.max(project.lengthBeats, lastEnd),
    lanes: lanes.slice(0, SUMMARY_MAX_LANES).map((lane) => lane.slice(0, SUMMARY_MAX_CLIPS)),
  };
}
