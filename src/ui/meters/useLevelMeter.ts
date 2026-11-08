/**
 * Drive a meter's elements from the engine's levels (DAW-8.5), straight onto the DOM once a frame,
 * never through React state: forty meters re-rendering at 60 fps would cost more than the mix. The
 * caller places three elements and hands their refs here: the bar (revealed from the left to the
 * level), the peak mark, and the clip light.
 */
import { useEffect, useRef } from "react";
import { positionOfGain } from "../controls/gainTaper";
import { nextMeter, SILENT_METER, type MeterState } from "./ballistics";
import { onMeterFrame } from "./meterLoop";

export interface MeterRefs {
  bar: React.RefObject<HTMLDivElement | null>;
  peak: React.RefObject<HTMLDivElement | null>;
  clip: React.RefObject<HTMLDivElement | null>;
}

/** Show `read()` (the loudest sample since the last frame, as a gain) on the elements in `refs`. */
export function useLevelMeter(read: (() => number) | undefined): MeterRefs {
  const bar = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  const enabled = read !== undefined;

  useEffect(() => {
    if (!enabled) return;
    let state: MeterState = SILENT_METER;
    return onMeterFrame((now) => {
      state = nextMeter(state, readRef.current?.() ?? 0, now);
      const level = positionOfGain(state.level);
      const mark = positionOfGain(state.peak);
      if (bar.current) bar.current.style.clipPath = `inset(0 ${(1 - level) * 100}% 0 0)`;
      if (peak.current) {
        peak.current.style.left = `${mark * 100}%`;
        peak.current.style.opacity = mark > 0.01 ? "1" : "0";
      }
      if (clip.current) clip.current.style.opacity = now < state.clipUntil ? "1" : "0";
    });
  }, [enabled]);

  return { bar, peak, clip };
}
