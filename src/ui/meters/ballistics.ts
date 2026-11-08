/**
 * How a meter moves (DAW-8.5), pure so it can be tested: it rises at once to a new peak and falls
 * back at a steady rate in decibels, as a desk's peak meter does; a peak-hold mark waits at the
 * loudest recent level before falling too; and a clip (a sample at or past full scale) holds its
 * light for a few seconds, so a single over isn't missed.
 */
import { decibelsOf } from "../controls/gainTaper";

/** How fast the bar falls back: 24 dB a second. */
const FALL_DB_PER_SECOND = 24;
/** How long the peak mark waits before falling. */
const HOLD_MS = 1500;
/** How long a clip stays lit. */
const CLIP_MS = 3000;
/** A sample this loud is a clip: full scale. */
export const CLIP_LEVEL = 0.999;

export interface MeterState {
  /** The bar's level, as a gain. */
  level: number;
  /** The peak mark's level, and when it was set. */
  peak: number;
  peakAt: number;
  /** Until when the clip light is on. */
  clipUntil: number;
  /** The last frame's time. */
  at: number;
}

export const SILENT_METER: MeterState = { level: 0, peak: 0, peakAt: 0, clipUntil: 0, at: 0 };

/** `gain` fallen back for `seconds` at the meter's rate. */
const fallen = (gain: number, seconds: number) => gain * 10 ** (-(FALL_DB_PER_SECOND * seconds) / 20);

/** The meter at `now`, having read `input` (the loudest sample since the last frame). */
export function nextMeter(state: MeterState, input: number, now: number): MeterState {
  const seconds = state.at === 0 ? 0 : Math.max(0, now - state.at) / 1000;
  const level = Math.max(input, fallen(state.level, seconds));
  const holding = now - state.peakAt < HOLD_MS;
  const peakFell = holding ? state.peak : fallen(state.peak, seconds);
  const newPeak = input >= peakFell;
  return {
    level: decibelsOf(level) === -Infinity ? 0 : level,
    peak: newPeak ? input : peakFell,
    peakAt: newPeak ? now : state.peakAt,
    clipUntil: input >= CLIP_LEVEL ? now + CLIP_MS : state.clipUntil,
    at: now,
  };
}
