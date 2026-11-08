/**
 * Drive a meter's elements from the engine's levels (DAW-8.5), straight onto the DOM once a frame,
 * never through React state: forty meters re-rendering at 60 fps would cost more than the mix. The
 * caller places the elements it wants and hands their refs here: the bar (revealed from the left to
 * the level), the peak mark, the clip light, and a readout of the peak in decibels. `reset` puts the
 * clip light out (and the peak back to the level) at once, for a click on the readout.
 */
import { useCallback, useEffect, useRef } from "react";
import { positionOfGain } from "../controls/gainTaper";
import { decibelsOf } from "../../audio/decibels";
import { nextMeter, SILENT_METER, type MeterState } from "./ballistics";
import { onMeterFrame } from "./meterLoop";

export interface LevelMeter {
  bar: React.RefObject<HTMLDivElement | null>;
  peak: React.RefObject<HTMLDivElement | null>;
  clip: React.RefObject<HTMLDivElement | null>;
  readout: React.RefObject<HTMLSpanElement | null>;
  reset: () => void;
}

/** The readout's text: the peak to a tenth of a dB, or a dash for silence. */
const readoutOf = (peak: number) => {
  const decibels = decibelsOf(peak);
  return decibels === -Infinity ? "-∞" : decibels.toFixed(1);
};

/** Show `read()` (the loudest sample since the last frame, as a gain) on the meter's elements. */
export function useLevelMeter(read: (() => number) | undefined): LevelMeter {
  const bar = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const readRef = useRef(read);
  const resetRef = useRef(false);
  useEffect(() => {
    readRef.current = read;
  });
  const enabled = read !== undefined;

  useEffect(() => {
    if (!enabled) return;
    let state: MeterState = SILENT_METER;
    return onMeterFrame((now) => {
      state = nextMeter(state, readRef.current?.() ?? 0, now);
      if (resetRef.current) {
        state = { ...state, peak: state.level, peakAt: now, clipUntil: 0 };
        resetRef.current = false;
      }
      const level = positionOfGain(state.level);
      const mark = positionOfGain(state.peak);
      const clipped = now < state.clipUntil;
      if (bar.current) bar.current.style.clipPath = `inset(0 ${(1 - level) * 100}% 0 0)`;
      if (peak.current) {
        peak.current.style.left = `${mark * 100}%`;
        peak.current.style.opacity = mark > 0.01 ? "1" : "0";
      }
      if (clip.current) clip.current.style.opacity = clipped ? "1" : "0";
      if (readout.current) {
        readout.current.textContent = readoutOf(state.peak);
        readout.current.dataset.clipped = String(clipped);
      }
    });
  }, [enabled]);

  const reset = useCallback(() => {
    resetRef.current = true;
  }, []);
  return { bar, peak, clip, readout, reset };
}
