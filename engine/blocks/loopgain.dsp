import("stdfaust.lib");
declare description "The gain for a feedback loop: what a signal going round a loop of `period` samples is multiplied by each time round, so that it dies away by 60 dB in `time` seconds whatever the period. Keeps a plucked string's decay even from low notes to high ones.";
declare input_ports "period 0 96000 samples, time 0.01 60 s";
declare output_ports "gain 0 1";
// 0.001 is -60 dB; each trip round takes period / SR seconds, and there are time * SR / period trips.
process(period, time) = pow(0.001, max(0, period) / (max(0.01, time) * ma.SR));
