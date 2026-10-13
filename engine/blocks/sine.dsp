import("stdfaust.lib");
declare description "A sine wave.";
declare input_ports "frequency 0 24000 Hz";
declare output_ports "signal -1 1";
process(freq) = os.osc(freq);
