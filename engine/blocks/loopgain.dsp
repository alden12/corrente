import("stdfaust.lib");
declare description "The gain for a feedback loop: what a signal going round a loop of `period` samples is multiplied by each time round, so that it dies away by 60 dB in `time` seconds whatever the period. Keeps a plucked string's decay even from low notes to high ones. Both are controls, read every 32 samples, since they barely move within a note.";
declare input_ports "";
declare output_ports "gain 0 1";
// 0.001 is -60 dB; each trip round takes period / SR seconds, and there are time * SR / period trips.
// As controls rather than audio inputs, the power is worked out 4 times a block, not 128.
period = hslider("[0]period[unit:samples]", 100, 0, 96000, 0);
time = hslider("[1]time[unit:s]", 3, 0.01, 60, 0);
process = pow(0.001, max(0, period) / (max(0.01, time) * ma.SR));
