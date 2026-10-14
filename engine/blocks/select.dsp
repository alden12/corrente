import("stdfaust.lib");
declare description "Picks one of four signals by index (0 to 3, rounded to the nearest): a waveform or mode switch, fed by a choice param, which reads as its option's index. Wire any unused choice to 0. The switch is instant, so changing it mid-note can click.";
declare input_ports "index 0 3, a -24000 24000, b -24000 24000, c -24000 24000, d -24000 24000";
declare output_ports "signal -24000 24000";
// Each choice is multiplied by whether it's the one picked, and the four summed: plain arithmetic,
// so it needs no library code and carries no licence beyond the engine's own.
process(index, a, b, c, d) = a * (choice == 0) + b * (choice == 1) + c * (choice == 2) + d * (choice == 3)
with {
  choice = int(max(0, min(3, index + 0.5)));
};
