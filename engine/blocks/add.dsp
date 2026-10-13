// Add two signals. Wide ranges, since it sums frequencies as well as audio.
declare description "Adds two signals.";
declare input_ports "a -24000 24000, b -24000 24000";
declare output_ports "sum -48000 48000";
process = +;
