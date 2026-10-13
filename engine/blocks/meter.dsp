import("stdfaust.lib");
// Passes its signal through unchanged and shows its level on a meter, as a channel meter does: it
// rises at once and falls back over about 300 ms. Audio input: signal. Meter: level (linear).
process(signal) = attach(signal, signal : an.amp_follower(0.3) : vbargraph("[0]level", 0, 2));
