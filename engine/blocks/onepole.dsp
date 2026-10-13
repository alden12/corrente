import("stdfaust.lib");
// A gentle one-pole low-pass, for damping inside feedback loops. Audio input: signal.
// Control input: cutoff (Hz).
cutoff = hslider("[0]cutoff", 8000, 20, 20000, 0);
process = fi.lowpass(1, max(20, min(20000, cutoff)));
