import("stdfaust.lib");
declare description "Passes its signal through unchanged and shows its level on a meter, as a channel meter does: it rises at once and falls back over about 300 ms.";
declare input_ports "signal -1 1";
declare output_ports "signal -1 1";
process(signal) = attach(signal, signal : an.amp_follower(0.3) : vbargraph("[0]level", 0, 2));
