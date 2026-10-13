/** How much of a clip its glance shows (`ClipPreview`): the clip rail's chips and the minimised sheet. */

/**
 * The most a preview shows, from the clip's start (2026-10-13, Alden). Past about this, a whole
 * clip squeezed into a chip's width turns its notes to specks; a longer clip shows its opening
 * bars and fades out at the right edge, so it reads as continuing.
 */
export const PREVIEW_BARS = 8;

/** How many beats a preview spans, and whether the clip runs on past them. */
export function previewWindow(lengthBeats: number, beatsPerBar: number): { length: number; continues: boolean } {
  const length = Math.min(lengthBeats, PREVIEW_BARS * beatsPerBar);
  return { length, continues: lengthBeats > length };
}
