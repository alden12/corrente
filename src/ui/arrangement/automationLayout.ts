/**
 * The automation rows' geometry on the timeline (DAW-67.4), apart from their component so the
 * timeline can size its content from it.
 */
import type { Track } from "../../audio/project/projectStore";
import { automationRuns, type AutomationRun } from "../../audio/automation/playback";
import { packRuns } from "../../audio/automation/rows";

/** One automation row's height, and a folded track's band. */
export const AUTOMATION_ROW_PX = 30;
export const FOLDED_BAND_PX = 8;
/** A track's automation as the timeline shows it: the arrangement's, whatever is launched. */
export function timelineRuns(track: Track): AutomationRun[] {
  return automationRuns({ ...track, launchedClipId: null }, 0, 0);
}

/** How tall a track's automation is on the timeline: its visible rows, a band folded, or nothing. */
export function automationHeight(track: Track, folded: boolean, hidden: ReadonlySet<number>): number {
  const { rows } = packRuns(timelineRuns(track));
  if (rows === 0) return 0;
  if (folded) return FOLDED_BAND_PX;
  return Array.from({ length: rows }, (_, row) => row).filter((row) => !hidden.has(row)).length * AUTOMATION_ROW_PX;
}
