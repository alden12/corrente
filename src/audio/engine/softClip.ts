/**
 * The master's soft clip (INST-46), as plain maths: the live master shapes with it (mixer.ts), and a
 * render without Web Audio applies it sample by sample (render/renderProject.ts).
 */

/** Where the soft clip starts to bend, and how far past full scale its curve reaches. */
export const SOFT_CLIP_KNEE = 0.9;
export const SOFT_CLIP_RANGE = 4;

/** Unchanged up to the knee, then curving smoothly toward full scale and never past it. */
export const softClip = (sample: number): number => {
  const size = Math.abs(sample);
  if (size <= SOFT_CLIP_KNEE) return sample;
  const room = 1 - SOFT_CLIP_KNEE;
  return Math.sign(sample) * (SOFT_CLIP_KNEE + room * Math.tanh((size - SOFT_CLIP_KNEE) / room));
};
