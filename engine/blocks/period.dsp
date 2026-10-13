import("stdfaust.lib");
// A frequency's period in samples, less an offset: the delay that tunes a plucked string. Inputs: frequency (Hz), offset (samples).
process(freq, offset) = ma.SR / max(1, freq) - offset;
