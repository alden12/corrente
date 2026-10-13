import("stdfaust.lib");
declare description "A band-limited sawtooth.";
declare input_ports "frequency 0 24000 Hz";
declare output_ports "signal -1 1";
process(freq) = os.sawtooth(freq);
