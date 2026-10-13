import("stdfaust.lib");
declare description "Equal-power pan: one signal to a left and a right output, so its level stays even as it moves. Pan 0 is hard left, 0.5 centre, 1 hard right.";
declare input_ports "signal -1 1";
declare output_ports "left -1 1, right -1 1";
pan = hslider("[0]pan", 0.5, 0, 1, 0);
process(signal) = signal * cos(angle), signal * sin(angle)
with {
  angle = max(0, min(1, pan)) * ma.PI / 2;
};
