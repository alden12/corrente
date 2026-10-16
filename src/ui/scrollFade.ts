/**
 * A sideways scroller whose edges fade out where there is more beyond them, rather than cutting
 * the last item off hard: Explore's shelves, and the workbench's device chips.
 */
import { useEffect, useState } from "react";

/** How far an edge fades out when there is more beyond it. */
const FADE = 28;

/** A mask that fades whichever edges have more beyond them. */
export const edgeFade = ({ back, on }: { back: boolean; on: boolean }): string =>
  `linear-gradient(to right, ${back ? "transparent" : "black"} 0, black ${back ? FADE : 0}px, ` +
  `black calc(100% - ${on ? FADE : 0}px), ${on ? "transparent" : "black"} 100%)`;

/** Whether the row can scroll further back and further on, kept current as it scrolls or resizes. */
export function useScrollEnds(row: React.RefObject<HTMLElement | null>, count: number) {
  const [ends, setEnds] = useState({ back: false, on: false });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () =>
      setEnds({
        back: element.scrollLeft > 1,
        on: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      });
    // The observer reports the row's size as soon as it starts watching, which is the first measure.
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      resize.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [row, count]);
  return ends;
}
