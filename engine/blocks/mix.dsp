// Dry/wet in one node (INST-42): what every effect did with two scaled adds. `mix` is an input, not a
// control, so an LFO or envelope can move it every sample.
declare description "Crossfades from a dry signal to a wet one: mix 0 is all dry, 1 all wet, in a straight line between, so an effect's dry/wet knob is one node. Mix is held to 0..1.";
declare input_ports "dry -16 16, wet -16 16, mix 0 1";
declare output_ports "signal -16 16";
process(dry, wet, mix) = dry * (1 - amount) + wet * amount
with {
  amount = max(0, min(1, mix));
};
