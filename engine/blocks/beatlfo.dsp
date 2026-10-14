import("stdfaust.lib");
declare description "A low-frequency oscillator locked to the beat: wire `beat` to host.beat and give `length` a cycle's length in beats (a synced input with as beats, or a number). Its phase is worked out from the beat alone, so it starts in the same place every time play starts and stays in step through tempo changes. Sine, triangle, saw and square outputs from -1 to 1, shaped like lfo's; `phase` shifts it (0.25 is a quarter cycle late).";
declare input_ports "beat 0 100000 beats, length 0.0625 64 beats";
declare output_ports "sine -1 1, triangle -1 1, saw -1 1, square -1 1";
// Where in its cycle the beat is, 0 to 1, less the phase shift; every shape follows it, as in lfo.
process(beat, length) = phase <: sin(2 * ma.PI * _), 1 - 4 * abs(ma.frac(_ + 0.25) - 0.5), 2 * _ - 1, select2(_ < 0.5, -1, 1)
with {
  shift = hslider("[0]phase", 0, 0, 1, 0);
  phase = ma.frac(max(0, beat) / max(0.0625, min(64, length)) - shift + 1);
};
