import("stdfaust.lib");
// A sine. Inputs: frequency (Hz).
process(freq) = os.osc(freq);
