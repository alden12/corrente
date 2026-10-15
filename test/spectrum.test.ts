import { describe, expect, it } from "vitest";
import { spectrumOf } from "../src/audio/analysis/spectrum";

const RATE = 48000;
const sine = (hz: number, amplitude: number) =>
  Float32Array.from({ length: RATE }, (_, index) => amplitude * Math.sin((2 * Math.PI * hz * index) / RATE));

describe("spectrumOf", () => {
  it("puts a sine's level in its octave, in RMS dBFS, and its centroid on it", () => {
    const { bands, centroidHz } = spectrumOf(sine(1000, 0.5), RATE);
    const band = (hz: number) => bands.find((each) => each.hz === hz)!.db;
    // 0.5 peak is 0.354 RMS: -9.0 dB.
    expect(band(1000)).toBeCloseTo(-9.03, 1);
    expect(band(250)).toBeLessThan(-80);
    expect(band(4000)).toBeLessThan(-80);
    expect(centroidHz).toBeCloseTo(1000, -1);
  });

  it("finds the balance between two tones", () => {
    const high = sine(4000, 0.5);
    const both = sine(250, 0.5).map((value, index) => value + high[index]);
    expect(spectrumOf(both, RATE).centroidHz).toBeCloseTo(2125, -1);
  });

  it("reads silence as the floor", () => {
    const { bands, centroidHz } = spectrumOf(new Float32Array(RATE), RATE);
    expect(bands.every((band) => band.db === -120)).toBe(true);
    expect(centroidHz).toBe(0);
  });
});
