/**
 * The built-in wavetables (no DOM, so unit-testable on their own): banks of single-cycle
 * waveforms a `wavetable` block morphs through, dark to bright (render/sampleAudio.ts loads
 * them). The brighter tables are built additively from a bounded number of partials.
 */

export const TABLE_SIZE = 2048;
const PARTIALS = 32; // harmonics in the additive tables (bounds aliasing)

/** Build one single-cycle table from per-harmonic amplitudes `amp(k)` (k = 1..PARTIALS). */
function additive(amp: (k: number) => number): Float32Array {
  const table = new Float32Array(TABLE_SIZE);
  let peak = 0;
  for (let i = 0; i < TABLE_SIZE; i++) {
    const t = (i / TABLE_SIZE) * 2 * Math.PI;
    let sum = 0;
    for (let k = 1; k <= PARTIALS; k++) sum += amp(k) * Math.sin(k * t);
    table[i] = sum;
    peak = Math.max(peak, Math.abs(sum));
  }
  if (peak > 0) for (let i = 0; i < TABLE_SIZE; i++) table[i] /= peak; // normalize to [-1, 1]
  return table;
}

/**
 * The morph bank, dark -> bright: sine, triangle (odd harmonics 1/k^2), square
 * (odd harmonics 1/k), sawtooth (all harmonics 1/k).
 */
export function buildTables(): Float32Array[] {
  return [
    additive((k) => (k === 1 ? 1 : 0)),
    additive((k) => (k % 2 === 1 ? (((k - 1) / 2) % 2 === 0 ? 1 : -1) / (k * k) : 0)),
    additive((k) => (k % 2 === 1 ? 1 / k : 0)),
    additive((k) => 1 / k),
  ];
}

const pulse = (width: number) => (k: number) => Math.sin(Math.PI * k * width) / k;

/**
 * The built-in wavetables a `wavetable` block morphs through, each dark to bright, by the id
 * BUILTIN_WAVETABLES (samples/catalog.ts) names them by:
 * - classic: sine, triangle, square, sawtooth - the Wavetable instrument's bank;
 * - harmonics: the fundamental, then 2, 4, 8 and 16 equal harmonics - an organ's drawbars pulled out;
 * - pulse: a square narrowing to a thin pulse (widths 0.5, 0.3, 0.15, 0.05), the nasal end of PWM.
 */
const BUILTIN_CYCLES: Record<string, () => Float32Array[]> = {
  classic: buildTables,
  harmonics: () => [1, 2, 4, 8, 16].map((count) => additive((k) => (k <= count ? 1 : 0))),
  pulse: () => [0.5, 0.3, 0.15, 0.05].map((width) => additive(pulse(width))),
};

/** A built-in wavetable's single cycles by its id, or undefined for one there isn't. */
export const builtinWavetable = (id: string): Float32Array[] | undefined => BUILTIN_CYCLES[id]?.();

/** Every built-in wavetable's id. */
export const builtinWavetableIds = (): string[] => Object.keys(BUILTIN_CYCLES);
