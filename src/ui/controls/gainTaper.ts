/**
 * Where a volume sits on a fader, and what a fader's position means as a volume (DAW-8.5). A cube
 * law: the gain is the position cubed. A fader linear in gain gives half its travel to the top 6 dB
 * and leaves a mix's ordinary levels squeezed against the left (-20 dB at a tenth of the way); this
 * spreads them out as a mixing desk does: -6 dB at 79%, -20 dB at 46%, -40 dB at 22%.
 *
 * The meters use the same law, so a level's bar and a fader set to that level reach the same place.
 * Saved volumes stay plain gains: only the mapping to the screen changed.
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A gain's place on a fader topping out at `max`, 0..1. */
export const positionOfGain = (gain: number, max = 1): number => Math.cbrt(clamp01(gain / max));

/** The gain at a fader's position 0..1, on one topping out at `max`. */
export const gainOfPosition = (position: number, max = 1): number => max * clamp01(position) ** 3;

/** Below this a gain shows as silence: -80 dB. */
const SILENT = 1e-4;

/** A gain in decibels, -Infinity for silence. */
export const decibelsOf = (gain: number): number => (gain <= SILENT ? -Infinity : 20 * Math.log10(gain));

/** `-6.0 dB`, `+2.5 dB`, `0.0 dB`, or `-∞ dB` for silence. */
export function formatDecibels(gain: number): string {
  const decibels = decibelsOf(gain);
  if (decibels === -Infinity) return "-∞ dB";
  const rounded = Math.round(decibels * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${(rounded === 0 ? 0 : rounded).toFixed(1)} dB`;
}
