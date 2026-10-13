import("stdfaust.lib");
declare description "Soft saturation: drive 1 is clean, higher is warmer then harder.";
declare input_ports "signal -1 1";
declare output_ports "signal -1 1";
drive = hslider("[0]drive", 1, 1, 100, 0);
process(x) = ma.tanh(x * max(1, drive)) / ma.tanh(max(1, drive));
