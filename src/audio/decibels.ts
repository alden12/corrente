/** Gains as decibels (DAW-8.5): what the faders, meters and the edit feed read out. Pure. */

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
