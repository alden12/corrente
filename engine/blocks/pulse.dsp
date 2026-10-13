import("stdfaust.lib");
declare description "A band-limited pulse wave whose width can move every sample (pulse-width modulation): width 0.5 is a square from -1 to 1. It has no DC offset, as an analog synth's output has none, so a narrow pulse reaches towards 2 on its short side. An octave down, it is a sub-oscillator.";
declare input_ports "frequency 0 24000 Hz, width 0 1";
declare output_ports "signal -2 2";
process(freq, width) = os.pulsetrainN(2, freq, max(0, min(1, width)));
