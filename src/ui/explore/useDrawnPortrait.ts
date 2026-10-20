/**
 * A card's drawn portrait (COMM-1.9.6): asked for only while the card is on screen, and let go when
 * it scrolls away, so a long list draws what you're looking at and nothing else. Until it's drawn
 * (or if it can't be), there's none, and the card shows its category's glyph.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { knownPortrait, portraitKey, subscribePortraits, wantPortrait } from "../../audio/portraits/portraitCache";
import { canonicalJson } from "../../audio/contentHash";
import type { PortraitJob } from "../../audio/portraits/devicePortrait";
import type { Portrait } from "../../audio/portraits/draw";

/** Returns the ref to put on the card, and its portrait once drawn. */
export function useDrawnPortrait(
  job: PortraitJob | undefined,
): [(element: Element | null) => void, Portrait | undefined] {
  const [element, setElement] = useState<Element | null>(null);
  // The job by content, so a list re-rendering with an equal job doesn't hash and ask again.
  const content = job && canonicalJson(job);
  // Its key, once hashed, with the content it's for: a key for another job is none.
  const [hashed, setHashed] = useState<{ content: string; key: string }>();
  const key = content !== undefined && hashed?.content === content ? hashed.key : undefined;

  useEffect(() => {
    if (!job || !content) return;
    let current = true;
    void portraitKey(job).then((hash) => current && setHashed({ content, key: hash }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `content` is the job, compared by value
  }, [content]);

  useEffect(() => {
    if (!element || !key || !job || knownPortrait(key)) return;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) release ??= wantPortrait(key, job);
      else {
        release?.();
        release = undefined;
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      release?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already stands for the job
  }, [element, key]);

  const portrait = useSyncExternalStore(subscribePortraits, () => (key ? knownPortrait(key) : undefined));
  return [setElement, portrait];
}
