import("stdfaust.lib");
declare description "A band-limited triangle wave, rising from 0 at the start of its cycle. Its frequency can move every sample.";
declare input_ports "frequency 0 24000 Hz";
declare output_ports "signal -1 1";
// The triangle from its phase, its two corners smoothed with polyBLAMP (a cubic over the sample either
// side of each corner) so the corners don't alias. Faust's os.triangle integrates a square instead,
// which runs away when its frequency jumps.
process(freq) = naive + 4 * dt * (blamp(frac(phase + 0.25)) - blamp(frac(phase + 0.75)))
with {
  f = max(0, min(0.45 * ma.SR, freq));
  dt = f / ma.SR;
  phase = os.lf_sawpos(f);
  frac(x) = x - floor(x);
  naive = 1 - 4 * abs(frac(phase + 0.25) - 0.5);
  // The residual a corner at phase 0 leaves within one sample either side of it.
  blamp(t) = select2(t < dt, select2(t > 1 - dt, 0, after(t)), before(t))
  with {
    before(t) = 0 - pow(t / max(dt, 1e-9) - 1, 3) / 3;
    after(t) = pow((t - 1) / max(dt, 1e-9) + 1, 3) / 3;
  };
};
