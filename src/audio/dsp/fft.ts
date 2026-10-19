/** The fast Fourier transform, shared by the wavetables (samples/tables.ts) and analysis. */

/**
 * Each length's twiddle factors, cos and sin of -2 pi k / n for k below n / 2, made once. Computing
 * them per butterfly made a 4096-point transform about ten times slower, and analysis runs hundreds.
 */
const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>();

const twiddlesFor = (n: number) => {
  const known = twiddles.get(n);
  if (known) return known;
  const made = {
    cos: Float64Array.from({ length: n / 2 }, (_, index) => Math.cos((-2 * Math.PI * index) / n)),
    sin: Float64Array.from({ length: n / 2 }, (_, index) => Math.sin((-2 * Math.PI * index) / n)),
  };
  twiddles.set(n, made);
  return made;
};

/**
 * An in-place FFT of `real` and `imaginary` (a power of two long), or its inverse (scaled by 1 / n).
 * Iterative radix-2: reorder by reversed bit index, then combine pairs, fours, eights and so on.
 * Plain loops and temporaries rather than destructuring, since this is analysis's hot path.
 */
export const fft = (real: Float64Array, imaginary: Float64Array, inverse: boolean): void => {
  const n = real.length;
  for (let index = 1, reversed = 0; index < n; index++) {
    let bit = n >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      const swapReal = real[index];
      real[index] = real[reversed];
      real[reversed] = swapReal;
      const swapImaginary = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = swapImaginary;
    }
  }
  const { cos: cosines, sin: sines } = twiddlesFor(n);
  const direction = inverse ? -1 : 1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size / 2;
    // A size's k-th twiddle is the whole length's (k * n / size)-th.
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let offset = 0; offset < half; offset++) {
        const cos = cosines[offset * stride];
        const sin = direction * sines[offset * stride];
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * cos - imaginary[odd] * sin;
        const oddImaginary = real[odd] * sin + imaginary[odd] * cos;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }
  if (inverse) real.forEach((_, index) => ((real[index] /= n), (imaginary[index] /= n)));
};
