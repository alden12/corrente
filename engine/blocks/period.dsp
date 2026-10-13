import("stdfaust.lib");
declare description "A frequency's period in samples, less an offset: the delay that tunes a plucked string.";
declare input_ports "frequency 0 24000 Hz, offset 0 100 samples";
declare output_ports "period -100 96000 samples";
process(freq, offset) = ma.SR / max(1, freq) - offset;
