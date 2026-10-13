declare description "Shifts a frequency by semitones, such as an envelope or LFO in semitones onto a cutoff.";
declare input_ports "frequency 0 24000 Hz";
declare output_ports "frequency 0 6144000 Hz";
// Semitones is a control, so the power of two is worked out every 32 samples rather than every one.
semitones = hslider("[0]semitones", 0, -96, 96, 0);
process(freq) = freq * pow(2, max(-96, min(96, semitones)) / 12);
