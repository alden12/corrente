import("stdfaust.lib");
declare description "A low-frequency oscillator with sine, triangle, saw and square outputs from -1 to 1, all starting their cycle together: sine and triangle rise from 0, the square is high for the first half, the saw climbs from -1. Its rate can move every sample.";
declare input_ports "rate 0 100 Hz";
declare output_ports "sine -1 1, triangle -1 1, saw -1 1, square -1 1";
// One phase, 0 to 1, shared by every shape, so they rise and fall together. The triangle is shifted a
// quarter cycle so it peaks with the sine.
process(rate) = phase <: sin(2 * ma.PI * _), 1 - 4 * abs(ma.frac(_ + 0.25) - 0.5), 2 * _ - 1, select2(_ < 0.5, -1, 1)
with {
  phase = os.lf_sawpos(max(0, min(100, rate)));
};
