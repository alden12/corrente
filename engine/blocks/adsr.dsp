import("stdfaust.lib");
// An ADSR envelope, 0..1. Audio input: gate. Control inputs: attack (s), decay (s), sustain (0..1), release (s).
attack = hslider("[0]attack", 0.005, 0, 30, 0);
decay = hslider("[1]decay", 0.2, 0, 30, 0);
sustain = hslider("[2]sustain", 1, 0, 1, 0);
release = hslider("[3]release", 0.2, 0, 30, 0);
process(gate) = en.adsr(attack, decay, sustain, release, gate);
