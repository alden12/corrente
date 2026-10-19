/**
 * A spectrogram of a render (AGENT-4.11): its level over time in log-spaced frequency rows, the grid
 * the picture Claude reads is drawn from (picture.ts). Pure Float32 math like spectrum.ts.
 *
 * Rows run 30 Hz to 20 kHz, evenly spaced in log frequency as an ear hears pitch. High up a row
 * spans many FFT bins and takes the loudest, so a thin partial isn't averaged away; low down a row
 * falls between bins and reads between them.
 */
import { fft } from "../dsp/fft";

export const LOWEST_HZ = 30;
export const HIGHEST_HZ = 20000;

export interface Spectrogram {
  /** `columns[time][row]`, level in dBFS (a full-scale sine reads 0), row 0 at the lowest frequency. */
  columns: Float32Array[];
  durationSec: number;
}

/** Samples a frame: about 85 ms at 48 kHz, fine enough to split the lowest notes. */
const FRAME = 4096;
const FLOOR_DB = -120;

const hann = Float64Array.from({ length: FRAME }, (_, index) => Math.sin((Math.PI * index) / FRAME) ** 2);
/** Scales a bin's magnitude so a full-scale sine's peak bin reads 1. */
const amplitudeScale = 2 / hann.reduce((total, weight) => total + weight, 0);

/** A row's centre frequency, for `rows` log-spaced rows. */
export const rowHz = (row: number, rows: number): number => LOWEST_HZ * (HIGHEST_HZ / LOWEST_HZ) ** (row / (rows - 1));

/** The spectrogram of `channels` mixed to mono, `width` frames across and `rows` frequencies up. */
export function spectrogramOf(
  channels: Float32Array[],
  sampleRate: number,
  { width, rows }: { width: number; rows: number },
): Spectrogram {
  const length = channels[0]?.length ?? 0;
  const mono = Float32Array.from(
    { length },
    (_, index) => channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length,
  );
  const binHz = sampleRate / FRAME;
  const halfStep = (HIGHEST_HZ / LOWEST_HZ) ** (0.5 / (rows - 1));
  /** For each row, the bins it spans, or failing that, the fractional bin it falls at. */
  const rowBins = Array.from({ length: rows }, (_, row) => {
    const hz = rowHz(row, rows);
    return {
      from: Math.ceil(hz / halfStep / binHz),
      to: Math.floor((hz * halfStep) / binHz),
      at: hz / binHz,
    };
  });

  const hop = width > 1 ? Math.max(0, length - FRAME) / (width - 1) : 0;
  const [real, imaginary] = [new Float64Array(FRAME), new Float64Array(FRAME)];
  const amplitude = new Float64Array(FRAME / 2 + 1);
  const columns = Array.from({ length: width }, (_, column) => {
    const start = Math.round(column * hop);
    hann.forEach((weight, index) => {
      real[index] = (mono[start + index] ?? 0) * weight;
      imaginary[index] = 0;
    });
    fft(real, imaginary, false);
    amplitude.forEach((_, bin) => (amplitude[bin] = Math.hypot(real[bin], imaginary[bin]) * amplitudeScale));
    return Float32Array.from(rowBins, ({ from, to, at }) => {
      const level =
        to >= from
          ? amplitude
              .subarray(from, Math.min(to, FRAME / 2) + 1)
              .reduce((loudest, value) => Math.max(loudest, value), 0)
          : interpolate(amplitude, at);
      return level > 1e-6 ? Math.max(FLOOR_DB, 20 * Math.log10(level)) : FLOOR_DB;
    });
  });
  return { columns, durationSec: length / sampleRate };
}

const interpolate = (values: Float64Array, at: number): number => {
  const below = Math.min(values.length - 1, Math.floor(at));
  const above = Math.min(values.length - 1, below + 1);
  return values[below] + (values[above] - values[below]) * (at - below);
};
