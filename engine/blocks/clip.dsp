declare description "Holds a signal between low and high, cutting off whatever goes past them: a hard limit on a modulation, or (on audio) hard clipping.";
declare input_ports "signal -24000 24000, low -24000 24000, high -24000 24000";
declare output_ports "signal -24000 24000";
// A high below the low is read as the low, so the range is never upside down.
process(signal, low, high) = max(low, min(max(low, high), signal));
