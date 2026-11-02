import("stdfaust.lib");
declare description "Glide (portamento): follows a frequency with a lag in octaves, as an analog synth's does, so a jump up and the same jump down take the same time. It jumps straight to the frequency when the gate rises, so a new note starts on pitch; with a legato device the gate stays up from one note to the next, and it slides between them.";
declare input_ports "frequency 0 24000 Hz, gate 0 1";
declare output_ports "frequency 0 24000 Hz";
time = hslider("[0]time[unit:s]", 0.1, 0, 10, 0);
pole = ba.tau2pole(max(0, time));
// Octaves from 1 Hz, so 0 Hz (no note yet) stays finite.
process(frequency, gate) = pow(2, step ~ _)
with {
  octaves = log(max(1, min(24000, frequency))) / log(2);
  high = gate > 0.5;
  rising = high & (1 - high');
  step(previous) = select2(rising, previous * pole + octaves * (1 - pole), octaves);
};
