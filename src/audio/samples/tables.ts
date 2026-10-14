/**
 * Wavetables for the new engine's `wavetable` block (INST-36.6): single cycles, each stored band-
 * limited at every level the engine reads (engine/src/router/wavetable.rs). Pure and DOM-free, so the
 * tests run it as is.
 *
 * - **A table** is a run of cycles of CYCLE samples, dark to bright: a built-in set (dsp/wavetable.ts),
 *   or a wavetable WAV file, which is the same thing back to back.
 * - **Levels:** level k keeps the first 1024 >> k harmonics of every cycle (all of them, 512, ...,
 *   1), so the engine can play each note from a level with nothing above half the sample rate. The
 *   harmonics are found with an FFT (a fast Fourier transform: a cycle as the sum of its harmonics),
 *   the ones above the level's limit dropped, and the cycle put back together.
 * - **Layout,** as the engine reads it: level 0's cycles one after another, then level 1's, and so on.
 */

/** Samples in a cycle; must match CYCLE in engine/src/router/wavetable.rs. */
export const CYCLE = 2048;
/** Levels per table; must match LEVELS there. */
export const LEVELS = 11;
/** The most cycles a table keeps (a wavetable WAV file has up to 256). */
export const MAX_CYCLES = 256;

/**
 * An in-place FFT of `real` and `imaginary` (a power of two long), or its inverse (scaled by 1 / n).
 * Iterative radix-2: reorder by reversed bit index, then combine pairs, fours, eights and so on.
 */
const fft = (real: Float64Array, imaginary: Float64Array, inverse: boolean): void => {
  const n = real.length;
  for (let index = 1, reversed = 0; index < n; index++) {
    let bit = n >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let offset = 0; offset < size / 2; offset++) {
        const [cos, sin] = [Math.cos(angle * offset), Math.sin(angle * offset)];
        const [even, odd] = [start + offset, start + offset + size / 2];
        const oddReal = real[odd] * cos - imaginary[odd] * sin;
        const oddImaginary = real[odd] * sin + imaginary[odd] * cos;
        [real[odd], imaginary[odd]] = [real[even] - oddReal, imaginary[even] - oddImaginary];
        [real[even], imaginary[even]] = [real[even] + oddReal, imaginary[even] + oddImaginary];
      }
    }
  }
  if (inverse) real.forEach((_, index) => ((real[index] /= n), (imaginary[index] /= n)));
};

/** One cycle at every level: the cycle with its harmonics above 1024 >> level dropped. */
const levelsOf = (cycle: Float32Array): Float32Array[] => {
  const real = Float64Array.from(cycle);
  const imaginary = new Float64Array(CYCLE);
  fft(real, imaginary, false);
  return Array.from({ length: LEVELS }, (_, level) => {
    const keep = (CYCLE / 2) >> level;
    // Bin h and its mirror, CYCLE - h, are harmonic h; the DC bin (0) always stays.
    const kept = (bin: number) => Math.min(bin, CYCLE - bin) <= keep;
    const [levelReal, levelImaginary] = [
      real.map((value, bin) => (kept(bin) ? value : 0)),
      imaginary.map((value, bin) => (kept(bin) ? value : 0)),
    ];
    fft(levelReal, levelImaginary, true);
    return Float32Array.from(levelReal);
  });
};

/** A table as the engine stores it, from its cycles (each CYCLE long): every level, level by level. */
export const tableOf = (cycles: Float32Array[]): Float32Array => {
  const levels = cycles.slice(0, MAX_CYCLES).map(levelsOf);
  const table = new Float32Array(LEVELS * levels.length * CYCLE);
  levels.forEach((cycle, index) =>
    cycle.forEach((level, levelIndex) => table.set(level, (levelIndex * levels.length + index) * CYCLE)),
  );
  return table;
};

/** Audio as the cycles of a wavetable: CYCLE samples each, any left over dropped. None if shorter than one. */
export const cyclesOf = (audio: Float32Array): Float32Array[] =>
  Array.from({ length: Math.min(MAX_CYCLES, Math.floor(audio.length / CYCLE)) }, (_, index) =>
    audio.slice(index * CYCLE, (index + 1) * CYCLE),
  );
