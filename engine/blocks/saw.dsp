import("stdfaust.lib");
// A band-limited sawtooth. Inputs: frequency (Hz).
process(freq) = os.sawtooth(freq);
