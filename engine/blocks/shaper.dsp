import("stdfaust.lib");
// Soft saturation. Audio input: signal. Control input: drive (1 = clean).
drive = hslider("[0]drive", 1, 1, 100, 0);
process(x) = ma.tanh(x * max(1, drive)) / ma.tanh(max(1, drive));
