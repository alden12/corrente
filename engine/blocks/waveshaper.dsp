import("stdfaust.lib");
declare description "Distortion by a curve, as the original graph format's shaper had them. shape: 0 classic (the original Distortion's), 1 tanh (smooth saturation), 2 hardClip (flat at full scale), 3 fold (folds back past full scale, bright). amount is the drive. The input is held to -1..1 first, as Web Audio's WaveShaperNode does.";
declare input_ports "signal -1 1";
declare output_ports "signal -1 1";
shape = hslider("[0]shape", 0, 0, 3, 1);
amount = hslider("[1]amount", 50, 0, 1000, 0);
process(signal) = ba.selectn(4, int(max(0, min(3, shape))), classic, smooth, hardClip, fold)
with {
  x = max(-1, min(1, signal));
  drive = max(0, amount);
  classic = (3 + drive) * x * 20 * (ma.PI / 180) / (ma.PI + drive * abs(x));
  smooth = ma.tanh((1 + drive * 0.2) * x) / ma.tanh(1 + drive * 0.2);
  hardClip = max(-1, min(1, (1 + drive * 0.2) * x));
  fold = sin(ma.PI / 2 * (1 + drive * 0.1) * x);
};
