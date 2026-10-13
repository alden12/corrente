import("stdfaust.lib");
declare description "A stereo algorithmic reverb (Zita-Rev1): a short pre-delay, then a dense tail that decays over the time set, faster in the highs above the damping frequency.";
declare input_ports "left -1 1, right -1 1";
declare output_ports "left -2 2, right -2 2";
predelay = hslider("[0]predelay[unit:ms]", 20, 0, 100, 0);
decay = hslider("[1]decay[unit:s]", 2.5, 0.2, 10, 0);
damping = hslider("[2]damping[unit:Hz]", 6000, 1500, 20000, 0);
mix = hslider("[3]mix", 0.3, 0, 1, 0);
process(left, right) = (left, right) <: (dry, wet) :> _, _
with {
  amount = max(0, min(1, mix));
  dry = *(1 - amount), *(1 - amount);
  t60 = max(0.2, min(10, decay));
  wet = re.zita_rev1_stereo(max(0, min(100, predelay)), 200, max(1500, min(20000, damping)), t60, t60, 192000) : *(amount), *(amount);
};
