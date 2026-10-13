import("stdfaust.lib");
// A zero-delay-feedback Moog ladder low-pass. Audio input: signal.
// Control inputs (read every 32 samples, so the coefficients are not recomputed per sample):
// cutoff (Hz), resonance (0..1, self-oscillates near 1).
cutoff = hslider("[0]cutoff", 4000, 20, 20000, 0);
resonance = hslider("[1]resonance", 0, 0, 1, 0);
process = ve.moogLadder(normFreq, q)
with {
  // moogLadder maps 0..1 onto 20 Hz..20 kHz logarithmically: cutoff = 2 * 10^(3 * normFreq + 1).
  normFreq = ((log10(max(20, min(20000, cutoff)) / 2) - 1) / 3);
  q = 0.707 + 24 * max(0, min(1, resonance));
};
