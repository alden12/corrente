import("stdfaust.lib");
declare description "A gentle one-pole low-pass, for damping inside feedback loops.";
declare input_ports "signal -1 1";
declare output_ports "signal -1 1";
cutoff = hslider("[0]cutoff[unit:Hz]", 8000, 20, 20000, 0);
process = fi.lowpass(1, max(20, min(20000, cutoff)));
