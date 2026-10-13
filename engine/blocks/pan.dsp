import("stdfaust.lib");
// Equal-power pan: one signal to a left and a right output, so the level stays even as it moves.
// Audio input: signal. Control input: pan (0 hard left, 0.5 centre, 1 hard right).
pan = hslider("[0]pan", 0.5, 0, 1, 0);
process(signal) = signal * cos(angle), signal * sin(angle)
with {
  angle = max(0, min(1, pan)) * ma.PI / 2;
};
