import("stdfaust.lib");
declare description "A biquad filter with the responses of Web Audio's BiquadFilterNode, so devices built on one sound the same here. type: 0 lowpass, 1 highpass, 2 bandpass, 3 lowshelf, 4 highshelf, 5 peaking, 6 notch, 7 allpass. q is in dB for lowpass and highpass (a resonant peak that high) and a plain Q for the rest; shelves ignore it. gain, in dB, is for the shelves and peaking. Stable however fast its settings move.";
declare input_ports "signal -1 1";
declare output_ports "signal -100 100";
type = hslider("[0]type", 0, 0, 7, 1);
frequency = hslider("[1]frequency[unit:Hz]", 350, 10, 24000, 0);
q = hslider("[2]q", 1, -40, 40, 0);
gain = hslider("[3]gain[unit:dB]", 0, -40, 40, 0);
// Web Audio's responses (the Audio EQ Cookbook's) from a trapezoidal state-variable filter (Andrew
// Simper's), not the direct form Web Audio runs them in: the same response, but it stays stable when
// its frequency or Q jumps, which a direct-form biquad doesn't. Each response is the input, the
// band-pass and the low-pass mixed by m0, m1 and m2.
process(v0) = m0 * v0 + m1 * v1 + m2 * v2
with {
  kind = int(max(0, min(7, type)));
  pick(lowpass, highpass, bandpass, lowshelf, highshelf, peaking, notch, allpass) =
    ba.selectn(8, kind, lowpass, highpass, bandpass, lowshelf, highshelf, peaking, notch, allpass);
  A = pow(10, max(-40, min(40, gain)) / 40);
  // Lowpass and highpass read q in dB; a shelf's slope is fixed at 1, a Q of 1/sqrt(2).
  Q = pick(pow(10, q / 20), pow(10, q / 20), plain, sqrt(0.5), sqrt(0.5), plain, plain, plain)
  with { plain = max(0.0001, q); };
  k = select2(kind == 5, 1 / Q, 1 / (Q * A));
  warped = tan(ma.PI * max(10, min(0.499 * ma.SR, frequency)) / ma.SR);
  g = pick(warped, warped, warped, warped / sqrt(A), warped * sqrt(A), warped, warped, warped);
  m0 = pick(0, 1, 0, 1, A * A, 1, 1, 1);
  m1 = pick(0, 0 - k, k, k * (A - 1), k * (1 - A) * A, k * (A * A - 1), 0 - k, -2 * k);
  m2 = pick(1, -1, 0, A * A - 1, 1 - A * A, 0, 0, 0);
  // v1 the band-pass and v2 the low-pass, from the two integrators' states carried a sample.
  v1v2 = (tick ~ (_, _)) : !, !, _, _
  with {
    tick(ic1, ic2) = 2 * v1 - ic1, 2 * v2 - ic2, v1, v2
    with {
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
      v3 = v0 - ic2;
      v1 = a1 * ic1 + a2 * v3;
      v2 = ic2 + a2 * ic1 + a3 * v3;
    };
  };
  v1 = v1v2 : _, !;
  v2 = v1v2 : !, _;
};
