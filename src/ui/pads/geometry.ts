/**
 * How much room the pads need, and how much of it they may have (MOBILE-6).
 *
 * **The octave count is a function of the space, not a constant.** A phone in landscape
 * can only really hold one row; a tablet in portrait can hold four. Picking a number for "the
 * mobile limit" would be wrong at both ends, so the limit is computed from the Studio's height,
 * and a share of it that depends on the sheet (`KEYS_SHARE`).
 *
 * Pure, so the fitting is unit-testable without a browser: the numbers below are the pad
 * layout's own, and `fitPads` is the only place they are turned into a decision.
 */
import { TOUCH_SECTION_HEADER_HEIGHT } from "../controls/SectionHeader";
import type { Detent } from "../shell/detents";

/** An in-scale pad. Comfortably over the 44px hit-target floor (MOBILE-2). */
export const PAD_HEIGHT = 52;
/**
 * An accidental, sitting above the row as a black key does: the note you reach *for*.
 *
 * Shorter than a natural, and that is now the only thing that distinguishes them. They used
 * to be narrower as well, which made them fiddly for the thing they are - a note you jab at
 * in passing - so they went to a full pad width and height took over the job of saying
 * "these are the ones off to the side". Still clear of the 44px floor with the gap included.
 */
export const ACCIDENTAL_HEIGHT = 30;
/**
 * Between stacked rows, and it depends on whether the accidentals are showing.
 *
 * With them on, the band already separates one row of naturals from the next, so 4px is
 * spacing. With them off the rows abut, and 4px is not a boundary a finger respects: a touch
 * near the seam lands on both rows and the octaves either side of it sound together. The gap
 * is doing hit-testing work there, not decoration, so it grows to something a fingertip
 * cannot straddle.
 *
 * `padRowHeight` reads the same function the layout does, so a row's measured height and its
 * drawn height cannot drift - that would either clip the last row or leave a dead strip.
 */
export const ROW_GAP = 4;
export const BARE_ROW_GAP = 12;
export const rowGap = (accidentals: boolean) => (accidentals ? ROW_GAP : BARE_ROW_GAP);
/**
 * Between pads, in both axes. The pads are separated by space rather than by borders, so this
 * is what makes them read as individual keys; it is also subtracted from an accidental's
 * width, since those are positioned rather than laid out and get no gap for free.
 */
export const PAD_GAP = 4;
/** The Keys section's header, which carries their controls when they are open (MOBILE-24). */
export const SECTION_HEADER = TOUCH_SECTION_HEADER_HEIGHT;
/** The padding under the pads, so the last row is not flush against the tab bar. */
export const PADS_PADDING = 8;

/**
 * How much of the Studio the keys may take, by where the sheet is (MOBILE-24). They dock under
 * it and push it up, so a share is what keeps the sheet worth having: at Half it is sharing the
 * screen with the arrangement already, so the keys get less there than at Full, where they
 * leave the sheet half. Minimised, the sheet is a bar, and the keys may have as much as at Full.
 *
 * It bounds the *limit*, not the default - what is on show is the stored octave count, which
 * starts at one - so it decides where `+` stops.
 */
export const KEYS_SHARE: Record<Detent, number> = { peek: 0.5, half: 0.25, full: 0.5 };

/**
 * How much one more row of pads costs: the row (its accidental band and the gap under that
 * included, when the accidentals are on) and the gap before the next.
 */
export const padRowHeight = (accidentals: boolean) =>
  PAD_HEIGHT + (accidentals ? ACCIDENTAL_HEIGHT + PAD_GAP : 0) + rowGap(accidentals);

/**
 * How tall `rows` rows are drawn. Gaps only go *between* rows, so the last one's is not there -
 * which the fitting used to charge for anyway, up to 12px, and on the wrong phone that was a
 * whole row left as a gap.
 */
export const padRowsHeight = (rows: number, accidentals: boolean) =>
  rows > 0 ? rows * padRowHeight(accidentals) - rowGap(accidentals) : 0;

/** How tall the keys are with `rows` rows showing: their header, the rows and the padding under them. */
export const keysHeight = (rows: number, accidentals: boolean) =>
  SECTION_HEADER + padRowsHeight(rows, accidentals) + PADS_PADDING;

/**
 * Rows of pads that fit in `room` pixels of keys, their header included. **Zero is a real
 * answer**: the section then says so, rather than showing half a pad.
 *
 * There is no constant ceiling: the room says how many rows there is space for and the pitch
 * range (`OCTAVE_RANGE`, applied in `padSettings`) says how many there are notes for, and
 * between them nothing arbitrary is left to pick.
 */
export function fitPads(room: number, accidentals: boolean): number {
  const space = room - SECTION_HEADER - PADS_PADDING;
  // The last row has no gap after it, so the room gets that gap back before dividing.
  return Math.max(0, Math.floor((space + rowGap(accidentals)) / padRowHeight(accidentals)));
}

/**
 * The room the keys may have in a Studio `studio` pixels tall, with the sheet at `detent`: their
 * share, and never less than one row of pads while the Studio has room for two, so a phone on its
 * side can still play at Half.
 */
export function keysRoom(studio: number, detent: Detent): number {
  const oneRow = keysHeight(1, true);
  return Math.max(studio * KEYS_SHARE[detent], studio >= 2 * oneRow ? oneRow : 0);
}
