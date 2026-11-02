declare description "The higher of two signals, sample by sample: a floor one signal puts under another.";
declare input_ports "a -24000 24000, b -24000 24000";
declare output_ports "signal -24000 24000";
process = max;
