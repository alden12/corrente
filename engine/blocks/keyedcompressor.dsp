import("stdfaust.lib");
declare description "A stereo compressor turned down by its key rather than by itself: both channels go down together when the louder side of the key passes the threshold, then are made up by the gain. A kick on the key ducks a bass (sidechain compression). Its meter shows the reduction in dB.";
declare input_ports "left -1 1, right -1 1, keyLeft -1 1, keyRight -1 1";
declare output_ports "left -16 16, right -16 16";
threshold = hslider("[0]threshold[unit:dB]", -18, -60, 0, 0);
ratio = hslider("[1]ratio", 4, 1, 20, 0);
attack = hslider("[2]attack[unit:s]", 0.01, 0.0001, 1, 0);
release = hslider("[3]release[unit:s]", 0.1, 0.001, 2, 0);
makeup = hslider("[4]makeup[unit:dB]", 0, 0, 24, 0);
process(left, right, keyLeft, keyRight) = left * gain, right * gain
with {
  reduction = max(abs(keyLeft), abs(keyRight)) : co.compression_gain_mono(max(1, ratio), threshold, max(0.0001, attack), max(0.001, release));
  shown = reduction : ba.linear2db : vbargraph("[5]reduction[unit:dB]", -60, 0);
  gain = attach(reduction, shown) * ba.db2linear(max(0, min(24, makeup)));
};
