import("stdfaust.lib");
declare description "Pink noise: falling 3 dB an octave, softer and closer to rain than white noise's hiss.";
declare input_ports "";
declare output_ports "noise -1 1";
process = no.pink_noise;
