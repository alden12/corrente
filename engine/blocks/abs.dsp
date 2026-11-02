declare description "The size of a signal, whatever its sign: an LFO folded to run 0 to 1 and back, a level from a swing.";
declare input_ports "signal -24000 24000";
declare output_ports "signal 0 24000";
process = abs;
