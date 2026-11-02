import("stdfaust.lib");
declare description "A sawtooth for hard sync: its cycle starts again each time sync rises through 0, so fed another oscillator (the master, at a lower frequency), it takes the master's pitch while its own frequency sweeps the tone. The classic sync lead. Band-limited at its own wraps and softened at the restarts. With sync unwired it is a plain sawtooth.";
declare input_ports "frequency 0 24000 Hz, sync -24000 24000 =0";
declare output_ports "signal -2 2";
process(freq, sync) = 2 * phase - 1 - wrapped - restarted
with {
  f = max(0, min(0.45 * ma.SR, freq));
  dt = max(f / ma.SR, 1e-9);
  // The sample sync rises through 0: where a master's cycle begins.
  restart = (sync > 0) & (sync' <= 0);
  frac(x) = x - floor(x);
  // Its phase, 0 to 1: on a little each sample, back to 0 at a restart.
  phase = step ~ _
  with {
    step(previous) = select2(restart, frac(previous + dt), 0);
  };
  // polyBLEP: the residual a jump of 2 at phase 0 leaves in the samples either side of it.
  blep(t) = select2(t < dt, select2(t > 1 - dt, 0, after(t)), before(t))
  with {
    before(t) = 2 * (t / dt) - (t / dt) * (t / dt) - 1;
    after(t) = ((t - 1) / dt) * ((t - 1) / dt) + 2 * ((t - 1) / dt) + 1;
  };
  // At its own wraps, nothing restarted: the usual polyBLEP. At a restart, the jump is however far the
  // saw had climbed, so the after half of the residual is scaled by it.
  wrapped = select2(restart, blep(phase), 0);
  height = 2 * frac(phase' + dt);
  restarted = select2(restart, 0, 0 - height / 2);
};
