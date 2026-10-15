/** The fast Fourier transform, shared by the wavetables (samples/tables.ts) and analysis. */

/**
 * An in-place FFT of `real` and `imaginary` (a power of two long), or its inverse (scaled by 1 / n).
 * Iterative radix-2: reorder by reversed bit index, then combine pairs, fours, eights and so on.
 */
export const fft = (real: Float64Array, imaginary: Float64Array, inverse: boolean): void => {
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
