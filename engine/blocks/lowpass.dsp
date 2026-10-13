import("stdfaust.lib");
// A resonant two-pole low-pass, the counterpart of Web Audio's biquad. Audio input: signal.
// Control inputs: cutoff (Hz), q.
cutoff = hslider("[0]cutoff", 4000, 20, 20000, 0);
q = hslider("[1]q", 0.707, 0.1, 40, 0);
process = fi.resonlp(max(20, min(20000, cutoff)), max(0.1, q), 1);
