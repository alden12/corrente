/**
 * Where a level sits along a meter (DAW-8.5), for the volume knobs' rings and the master's meter
 * alike. Up to 0 dBFS a meter follows the faders' taper (`gainTaper`) over the first 90% of its
 * length, so a fader set to a level and that level's meter reach the same place; the last 10% is
 * the over zone, 0 to +6 dB, which only a meter reaches: a mix summing past full scale before the
 * master's soft clip shows how far over it is, not just that it is.
 */
import { positionOfGain } from "../controls/gainTaper";
import { decibelsOf } from "../../audio/decibels";

/** How far past 0 dB the over zone reads. */
export const OVER_DB = 6;
/** Where 0 dB sits along a meter: the over zone is the rest. */
export const ZERO_AT = 0.9;

/** A gain's place along a meter, 0..1. */
export const meterPosition = (gain: number): number =>
  gain <= 1 ? positionOfGain(gain) * ZERO_AT : ZERO_AT + (1 - ZERO_AT) * Math.min(1, decibelsOf(gain) / OVER_DB);

/** Where the colours change: amber from -6 dB, red from -1 dB, as shares 0..1 of a meter. */
export const AMBER_AT = meterPosition(10 ** (-6 / 20));
export const RED_AT = meterPosition(10 ** (-1 / 20));

/** The colour at a place along a meter. */
export const meterColorAt = (position: number): string =>
  position >= RED_AT ? "var(--color-hot)" : position >= AMBER_AT ? "var(--color-warn)" : "var(--color-good)";

/** Green, amber, red across a straight meter's whole length, left to right. */
export const METER_GRADIENT = `linear-gradient(to right, var(--color-good) 0 ${AMBER_AT * 100}%, var(--color-warn) ${AMBER_AT * 100}% ${RED_AT * 100}%, var(--color-hot) ${RED_AT * 100}%)`;
