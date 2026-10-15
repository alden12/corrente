// A blend inside a device (INST-42): a phaser's or flanger's input and processed signal summed, which
// is the effect itself. An effect's own dry/wet knob is the chain's (definitions/chain.ts), not this.
// `mix` is an input, not a control, so an LFO or envelope can move it every sample.
declare description "Crossfades from one signal to another: mix 0 is all dry, 1 all wet, in a straight line between; held to 0..1. For a blend that makes the sound, such as a phaser's input and all-passed signal at half and half. An effect's dry/wet knob is its chain's, by a mix param.";
declare input_ports "dry -16 16, wet -16 16, mix 0 1";
declare output_ports "signal -16 16";
process(dry, wet, mix) = dry * (1 - amount) + wet * amount
with {
  amount = max(0, min(1, mix));
};
