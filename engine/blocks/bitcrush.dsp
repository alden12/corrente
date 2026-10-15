import("stdfaust.lib");
declare description "Lo-fi degradation: holds each sample for downsample samples (the aliasing crunch), then snaps it to one of 2^bits levels across -1 to 1 (the stair-stepped grit).";
declare input_ports "signal -1 1";
declare output_ports "signal -1 1";
bits = hslider("[0]bits", 8, 1, 16, 0);
downsample = hslider("[1]downsample", 4, 1, 50, 0);
process(signal) = ba.sAndH(take, signal) : quantize
with {
  period = max(1, floor(downsample));
  // Counts 1, 2, ... period - 1, 0, 1, ...: a fresh sample is taken at 1 (every sample when the period is 1).
  count = (+(1) : fmod(_, period)) ~ _;
  take = count == fmod(1, period);
  steps = pow(2, max(1, min(16, bits))) - 1;
  quantize(x) = rint((max(-1, min(1, x)) + 1) / 2 * steps) / steps * 2 - 1;
};
