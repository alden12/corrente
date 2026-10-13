import("stdfaust.lib");
declare description "An attack, decay, sustain, release envelope from 0 to 1, following a gate.";
declare input_ports "gate 0 1";
declare output_ports "envelope 0 1";
attack = hslider("[0]attack[unit:s]", 0.005, 0, 30, 0);
decay = hslider("[1]decay[unit:s]", 0.2, 0, 30, 0);
sustain = hslider("[2]sustain", 1, 0, 1, 0);
release = hslider("[3]release[unit:s]", 0.2, 0, 30, 0);
process(gate) = en.adsr(attack, decay, sustain, release, gate);
