/**
 * Wire a horizontally-scrolling arrangement surface to the shared view offset
 * (`gridView.ts`), so where you were looking survives the surface being unmounted and built
 * again - a shell swap, or a phone rotated into the tablet tier.
 *
 * Restores the offset on mount and publishes it while the user scrolls. Two things it
 * deliberately does *not* do, each having been a bug:
 *
 * - It does not follow later changes to the shared value. Doing so fought the user: the
 *   offset used to floor at 0, so scrolling left into the header gutter published 0, which
 *   notified this surface, which yanked `scrollLeft` forward to the gutter's edge. The
 *   timeline caught on the headers every time you scrolled to the start.
 * - It does not publish the restore itself. A surface that cannot *reach* the shared offset
 *   has its `scrollLeft` clamped by the browser, and publishing that clamped value would
 *   quietly overwrite the real one. Found via the lane strip MOBILE-5 has since deleted (it
 *   was short, and its content started at beat 0 so it could not show a gutter at all), but
 *   the rule outlives it: any surface narrower than the offset it is handed does the same.
 *
 * `leadPx` is how many pixels of the scrollable content sit *before* beat 0 - the header
 * width where that column scrolls away with the lanes (phone portrait), and zero where it
 * is `position: sticky` and therefore consumes no scroll (everywhere else). **Where the headers
 * scroll, the surface opens at the far left, showing them,** whatever offset is stored: on a phone
 * the headers are the mixer, and opening a bar in left them out of sight (2026-10-31, Alden). Once
 * you've scrolled it, a zoom restores the offset as ever.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { readGridScrollBeats, writeGridScrollBeats } from "./gridView";

export function useSharedGridScroll(ref: RefObject<HTMLElement | null>, pxPerBeat: number, leadPx = 0): void {
  const opened = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pxPerBeat <= 0) return;
    // Until you scroll it: the first runs can come before the header column is measured.
    const opening = !opened.current;

    // Restore before paint, so the surface never flashes at bar 1 first. With nothing to
    // restore, open at the content's left edge rather than at beat 0: where the header
    // column scrolls, beat 0 has already pushed the track names off screen.
    let restoring = true;
    const stored = readGridScrollBeats();
    el.scrollLeft = stored === null || (opening && leadPx > 0) ? 0 : leadPx + stored * pxPerBeat;

    const onScroll = () => {
      // The restore's own scroll event lands before the frame it was applied in ends;
      // anything after that is the user, and only the user gets to move the shared value.
      if (restoring) return;
      opened.current = true;
      writeGridScrollBeats((el.scrollLeft - leadPx) / pxPerBeat);
    };
    const settle = requestAnimationFrame(() => {
      restoring = false;
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(settle);
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, pxPerBeat, leadPx]);
}
