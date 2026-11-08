/**
 * The automation rows' geometry on the timeline (DAW-67.4), apart from their component so the
 * timeline can size its content from it.
 */
import type { Track } from "../../audio/project/projectStore";
import { automationRuns, type AutomationRun } from "../../audio/automation/playback";
import { packRuns } from "../../audio/automation/rows";

/** One automation row's height, and a folded track's band. */
export const AUTOMATION_ROW_PX = 30;
export const FOLDED_BAND_PX = 16;
/** A track's automation as the timeline shows it: the arrangement's, whatever is launched. */
export function timelineRuns(track: Track): AutomationRun[] {
  return automationRuns({ ...track, launchedClipId: null }, 0, 0);
}

/** How a track's automation rows show: folded into a band, and which rows are hidden. */
export interface AutomationView {
  folded: boolean;
  hidden: ReadonlySet<number>;
  onFold: () => void;
  /** Bring the hidden rows back. */
  onShowHidden: () => void;
  onHideRow: (row: number) => void;
}

/** The rows of `rows` a view shows: none folded, else those not hidden. */
export const visibleRows = (rows: number, view: Pick<AutomationView, "folded" | "hidden">): number[] =>
  view.folded ? [] : Array.from({ length: rows }, (_, row) => row).filter((row) => !view.hidden.has(row));

/**
 * How tall a track's automation is on the timeline: its visible rows, or a band when folded or every
 * row is hidden (so there is still something to bring them back from), or nothing without any.
 */
export function automationHeight(track: Track, view: Pick<AutomationView, "folded" | "hidden">): number {
  const { rows } = packRuns(timelineRuns(track));
  if (rows === 0) return 0;
  const shown = visibleRows(rows, view).length;
  return shown === 0 ? FOLDED_BAND_PX : shown * AUTOMATION_ROW_PX;
}
