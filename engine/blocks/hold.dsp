import("stdfaust.lib");
declare description "Sample and hold: takes its signal's value each time the trigger rises above 0.5, and holds it until the next. With noise in, it makes random steps.";
declare input_ports "signal -1 1, trigger 0 1";
declare output_ports "signal -1 1";
process(signal, trigger) = ba.sAndH(rising, signal)
with {
  high = trigger > 0.5;
  rising = high & (1 - high');
};
