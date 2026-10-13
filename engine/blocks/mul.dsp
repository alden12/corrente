// Multiply two signals: a VCA, a depth, a ring modulator. Wide ranges, since it scales frequencies
// as well as audio.
declare description "Multiplies two signals: a VCA, a depth, a ring modulator.";
declare input_ports "a -24000 24000, b -24000 24000";
declare output_ports "product -576000000 576000000";
process = *;
