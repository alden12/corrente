declare description "1 while a is above b, else 0: a gate from a level (an envelope or an LFO past a threshold), or a switch for select.";
declare input_ports "a -24000 24000, b -24000 24000";
declare output_ports "signal 0 1";
process(a, b) = a > b;
