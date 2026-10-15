/**
 * Spectral balance (AGENT-4.1, "agent ears"): how a render's energy spreads across octaves, and its
 * centroid (the balance point of its spectrum: low for dark, high for bright). Pure Float32 math like
 * analyze.ts, so it runs anywhere: on the old engine's renders and the new one's alike (INST-36.8's
 * A/B), and later behind the agent's tools.
 */
import { fft } from "../dsp/fft";

/** Octave bands by their centres, in Hz: the usual ISO ones a mix is talked about in. */
export const OCTAVE_BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export interface Spectrum {
  /** Each octave band's level, RMS in dBFS (a full-scale sine is -3), floored at -120. */
  bands: { hz: number; db: number }[];
  /** Where the spectrum balances, in Hz; 0 for silence. */
  centroidHz: number;
}

/** Samples a frame: about 85 ms at 48 kHz, fine enough to split the lowest octave. */
const FRAME = 4096;
const FLOOR_DB = -120;

const hann = Float64Array.from({ length: FRAME }, (_, index) => Math.sin((Math.PI * index) / FRAME) ** 2);
const windowEnergy = hann.reduce((total, weight) => total + weight * weight, 0);

/**
 * The spectrum of `samples`, averaged over half-overlapping Hann-windowed frames. Each bin's power is
 * scaled (Parseval's theorem) so the bins of a band sum to that band's share of the mean square.
 */
export function spectrumOf(samples: Float32Array, sampleRate: number): Spectrum {
  const power = new Float64Array(FRAME / 2);
  const starts = Array.from(
    { length: Math.max(1, Math.floor((samples.length - FRAME) / (FRAME / 2)) + 1) },
    (_, index) => index * (FRAME / 2),
  );
  const [real, imaginary] = [new Float64Array(FRAME), new Float64Array(FRAME)];
  starts.forEach((start) => {
    hann.forEach((weight, index) => {
      real[index] = (samples[start + index] ?? 0) * weight;
      imaginary[index] = 0;
    });
    fft(real, imaginary, false);
    // Positive frequencies count twice, standing in for the negative ones.
    power.forEach((_, bin) => (power[bin] += (2 * (real[bin] ** 2 + imaginary[bin] ** 2)) / (FRAME * windowEnergy)));
  });
  power.forEach((_, bin) => (power[bin] /= starts.length));

  const binHz = sampleRate / FRAME;
  const bands = OCTAVE_BANDS.map((hz) => {
    const [low, high] = [hz / Math.SQRT2, hz * Math.SQRT2];
    const share = power.reduce(
      (total, value, bin) => (bin * binHz >= low && bin * binHz < high ? total + value : total),
      0,
    );
    return { hz, db: share > 1e-12 ? Math.max(FLOOR_DB, 10 * Math.log10(share)) : FLOOR_DB };
  });
  const total = power.reduce((sum, value) => sum + value, 0);
  const centroidHz = total > 1e-12 ? power.reduce((sum, value, bin) => sum + value * bin * binHz, 0) / total : 0;
  return { bands, centroidHz };
}
