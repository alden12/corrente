import("stdfaust.lib");
declare description "A stereo chorus: each channel mixed with a copy of itself, delayed by a few milliseconds that drift with a slow LFO, the two channels a quarter cycle apart.";
declare input_ports "left -1 1, right -1 1";
declare output_ports "left -1 1, right -1 1";
rate = hslider("[0]rate[unit:Hz]", 0.6, 0.01, 5, 0);
depth = hslider("[1]depth", 0.5, 0, 1, 0);
delay = hslider("[2]delay[unit:ms]", 12, 1, 30, 0);
mix = hslider("[3]mix", 0.5, 0, 1, 0);
// The longest delay: 30 ms plus the same again of drift, at up to 192 kHz.
MAX_DELAY = 16384;
process(left, right) = voice(left, 0), voice(right, 0.25)
with {
  phase = os.lf_sawpos(max(0.01, min(5, rate)));
  drift(offset) = sin(2 * ma.PI * ma.frac(phase + offset));
  length(offset) = max(1, min(30, delay)) * (1 + max(0, min(1, depth)) * drift(offset)) * ma.SR / 1000;
  wet(signal, offset) = de.fdelay(MAX_DELAY, min(MAX_DELAY - 1, length(offset)), signal);
  voice(signal, offset) = signal * (1 - amount) + wet(signal, offset) * amount
  with {
    amount = max(0, min(1, mix));
  };
};
