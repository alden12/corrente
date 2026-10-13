// Shift a frequency by semitones (an envelope or LFO in semitones onto a cutoff). Audio input: frequency (Hz).
// Control input: semitones, so the power of two is worked out every 32 samples rather than every one.
semitones = hslider("[0]semitones", 0, -1000, 1000, 0);
process(freq) = freq * pow(2, semitones / 12);
