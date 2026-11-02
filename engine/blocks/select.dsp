import("stdfaust.lib");
declare description "Picks one of eight signals by index (0 to 7, rounded to the nearest): a waveform or mode switch, fed by a choice param, which reads as its option's index. Inputs not wired read 0. Every input still runs whichever is picked, so switching between heavy branches costs all of them. The switch is instant, so changing it mid-note can click.";
declare input_ports "index 0 7, a -24000 24000 =0, b -24000 24000 =0, c -24000 24000 =0, d -24000 24000 =0, e -24000 24000 =0, f -24000 24000 =0, g -24000 24000 =0, h -24000 24000 =0";
declare output_ports "signal -24000 24000";
// A tree of two-way picks on the index's bits: seven per sample, whichever it is. Plain primitives, so
// it needs no library code and carries no licence beyond the engine's own.
process(index, a, b, c, d, e, f, g, h) = pick(4, pick(2, pick(1, a, b), pick(1, c, d)), pick(2, pick(1, e, f), pick(1, g, h)))
with {
  choice = int(max(0, min(7, index + 0.5)));
  // The second when the choice's `bit` is set, else the first.
  pick(bit, first, second) = select2((choice & bit) != 0, first, second);
};
