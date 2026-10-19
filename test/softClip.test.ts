import { describe, expect, it } from "vitest";
import { SOFT_CLIP_KNEE, softClip } from "../src/audio/engine/mixer";

describe("the master's soft clip (INST-46)", () => {
  it("leaves everything under the knee alone", () => {
    [0, 0.3, -0.5, SOFT_CLIP_KNEE, -SOFT_CLIP_KNEE].forEach((sample) => expect(softClip(sample)).toBe(sample));
  });

  it("bends louder samples toward full scale, keeping their order and never passing it", () => {
    const louder = [0.95, 1, 1.2, 1.5];
    const clipped = louder.map(softClip);
    clipped.forEach((sample, index) => {
      expect(sample).toBeLessThan(1);
      expect(sample).toBeGreaterThan(index === 0 ? SOFT_CLIP_KNEE : clipped[index - 1]);
    });
    // Far past it, as close to full scale as a float gets, and no further.
    expect(softClip(4)).toBeLessThanOrEqual(1);
    expect(softClip(-2)).toBeCloseTo(-softClip(2), 12);
  });

  it("has no corner at the knee", () => {
    const step = 1e-6;
    const slope = (softClip(SOFT_CLIP_KNEE + step) - softClip(SOFT_CLIP_KNEE)) / step;
    expect(slope).toBeCloseTo(1, 4);
  });
});
