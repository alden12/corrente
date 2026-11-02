declare description "The lower of two signals, sample by sample: a ceiling one signal puts on another.";
declare input_ports "a -24000 24000, b -24000 24000";
declare output_ports "signal -24000 24000";
process = min;
