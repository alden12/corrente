import("stdfaust.lib");
declare description "A state-variable filter with low-pass, band-pass and high-pass outputs at once, stable however fast its cutoff moves. Each peaks at the cutoff as q rises.";
declare input_ports "signal -1 1";
declare output_ports "lowpass -40 40, bandpass -40 40, highpass -40 40";
cutoff = hslider("[0]cutoff[unit:Hz]", 1000, 20, 20000, 0);
q = hslider("[1]q", 0.707, 0.1, 40, 0);
process(signal) = signal <: fi.svf.lp(f, r), fi.svf.bp(f, r), fi.svf.hp(f, r)
with {
  f = max(20, min(20000, cutoff));
  r = max(0.1, q);
};
