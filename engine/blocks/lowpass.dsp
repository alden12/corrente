import("stdfaust.lib");
declare description "A resonant two-pole low-pass, the counterpart of Web Audio's biquad, whose peak at the cutoff rises with q. A state-variable filter, so it stays stable however fast the cutoff moves.";
declare input_ports "signal -1 1";
declare output_ports "signal -40 40";
cutoff = hslider("[0]cutoff[unit:Hz]", 4000, 20, 20000, 0);
q = hslider("[1]q", 0.707, 0.1, 40, 0);
// A direct-form biquad (fi.resonlp) blew up to -9899 when its cutoff swept 20 Hz to 20 kHz in a block
// at q 40; the state-variable form keeps its state meaningful as the coefficients change.
process = fi.svf.lp(max(20, min(20000, cutoff)), max(0.1, q));
