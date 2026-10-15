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
import { fft } from "../dsp/fft";

/** Samples in a cycle; must match CYCLE in engine/src/router/wavetable.rs. */
export const CYCLE = 2048;
/** Levels per table; must match LEVELS there. */
export const LEVELS = 11;
/** The most cycles a table keeps (a wavetable WAV file has up to 256). */
export const MAX_CYCLES = 256;

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
