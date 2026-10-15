/**
 * The waveshaper curves of the old engine's Distortion (Web Audio's WaveShaperNode), kept as the
 * reference the engine's `waveshaper` block is tested against (engineBlocks.test.ts).
 */
export const SHAPER_SHAPES = ["classic", "tanh", "hardClip", "fold"] as const;
type ShaperShape = (typeof SHAPER_SHAPES)[number];

/** Waveshaper curve families, keyed by name. `amount` grows the drive, 0 (clean) to about 100. */
export const SHAPER_CURVES: Record<ShaperShape, (amount: number) => Float32Array<ArrayBuffer>> = {
  // The exact tanh-ish curve from the original Distortion effect.
  classic: (amount) => {
    const length = 1024;
    const curve = new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
    const deg = Math.PI / 180;
    for (let index = 0; index < length; index++) {
      const x = (index * 2) / length - 1;
      curve[index] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  },
  // Smooth saturation that levels off, the tube/tape sound.
  tanh: (amount) => {
    const drive = 1 + amount * 0.2;
    return curveOf((x) => Math.tanh(drive * x) / Math.tanh(drive));
  },
  // Flat clipping at full scale: harsher, more digital.
  hardClip: (amount) => {
    const drive = 1 + amount * 0.2;
    return curveOf((x) => Math.max(-1, Math.min(1, drive * x)));
  },
  // A wavefolder: past full scale the wave folds back on itself, adding bright, shifting harmonics.
  fold: (amount) => {
    const drive = 1 + amount * 0.1;
    return curveOf((x) => Math.sin((Math.PI / 2) * drive * x));
  },
};

/** A 1024-point curve over -1..1 from a transfer function. */
function curveOf(transfer: (x: number) => number): Float32Array<ArrayBuffer> {
  const length = 1024;
  const curve = new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < length; index++) curve[index] = transfer((index * 2) / length - 1);
  return curve;
}
