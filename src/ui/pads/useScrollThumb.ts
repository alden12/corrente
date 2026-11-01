/**
 * Where a column-reverse scroller is scrolled to, as the thumb its `ScrollRail` draws: watched on
 * scroll, whenever it or a row in it changes size, and as rows come and go.
 */
import { useEffect, useState } from "react";

/** The thumb, as shares of the rail's height; null when there is nothing to scroll. */
export type Thumb = { top: number; size: number };

/** Hand `ref` to the scroller (a callback ref, so a scroller that mounts later is watched too). */
export function useScrollThumb() {
  const [scroller, ref] = useState<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  useEffect(() => {
    if (!scroller) return;
    const measure = () => {
      const { scrollHeight, clientHeight, scrollTop } = scroller;
      const next =
        scrollHeight <= clientHeight + 1
          ? null
          : // Column-reverse scrolls with a scrollTop of 0 at the bottom and negative above it.
            {
              size: clientHeight / scrollHeight,
              top:
                ((scrollHeight - clientHeight + scrollTop) / (scrollHeight - clientHeight)) *
                (1 - clientHeight / scrollHeight),
            };
      // Only a real change sets state, so a scroll that moves nothing renders nothing.
      setThumb((previous) => (previous?.top === next?.top && previous?.size === next?.size ? previous : next));
    };
    const resizes = new ResizeObserver(measure);
    const watch = () => {
      resizes.disconnect();
      [scroller, ...Array.from(scroller.children)].forEach((element) => resizes.observe(element));
      measure();
    };
    const rows = new MutationObserver(watch);
    rows.observe(scroller, { childList: true });
    scroller.addEventListener("scroll", measure, { passive: true });
    watch();
    return () => {
      resizes.disconnect();
      rows.disconnect();
      scroller.removeEventListener("scroll", measure);
    };
  }, [scroller]);
  return { ref, scroller, thumb: scroller ? thumb : null };
}
