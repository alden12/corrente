//! Which voice slot plays each note: src/audio/bank/voices.ts in Rust, the same rules, so the plugin
//! plays notes as the app does.
//!
//! - At most `voices` play at once. A note past that cuts one: the voice released longest ago (it is
//!   fading anyway), else the held note started longest ago.
//! - A note already sounding is cut and starts again, so one key never stacks copies of itself.
//! - A cut voice fades out over a block while the new note starts in a spare slot.
//!
//! Its arrays are made once, when a plan loads; nothing here allocates on the audio thread.

pub struct VoiceAllocator {
    voices: usize,
    /// The slot the last `note_on` needs cut first.
    pub cut: Option<usize>,
    notes: Vec<Option<u8>>,
    held: Vec<bool>,
    cutting: Vec<bool>,
    started_at: Vec<u64>,
    released_at: Vec<u64>,
}

impl VoiceAllocator {
    pub fn new(slots: usize, voices: usize) -> Self {
        Self {
            voices: voices.min(slots),
            cut: None,
            notes: vec![None; slots],
            held: vec![false; slots],
            cutting: vec![false; slots],
            started_at: vec![0; slots],
            released_at: vec![0; slots],
        }
    }

    /// The slot to play `note` in from `time`, with `cut` set to a slot to cut first. `sounding` says
    /// whether the engine has a slot busy.
    pub fn note_on(&mut self, note: u8, time: u64, sounding: impl Fn(usize) -> bool) -> usize {
        self.cut = self.to_cut(note, &sounding);
        if let Some(cut) = self.cut {
            self.cutting[cut] = true;
            self.held[cut] = false;
            self.notes[cut] = None;
        }
        let slot = self.free_slot(&sounding);
        self.notes[slot] = Some(note);
        self.held[slot] = true;
        self.cutting[slot] = false;
        self.started_at[slot] = time;
        slot
    }

    /// The slot holding `note`, now released, or None if it isn't held (cut, or never started).
    pub fn note_off(&mut self, note: u8, time: u64) -> Option<usize> {
        let slot = (0..self.notes.len()).find(|&slot| self.notes[slot] == Some(note) && self.held[slot])?;
        self.held[slot] = false;
        self.released_at[slot] = time;
        Some(slot)
    }

    /// The slot to cut before `note` starts: its own copy if it's sounding, or one over the limit.
    fn to_cut(&self, note: u8, sounding: &impl Fn(usize) -> bool) -> Option<usize> {
        let mut playing = 0;
        let (mut released, mut oldest): (Option<usize>, Option<usize>) = (None, None);
        for slot in 0..self.notes.len() {
            if self.cutting[slot] || !(self.held[slot] || sounding(slot)) {
                continue;
            }
            if self.notes[slot] == Some(note) {
                return Some(slot);
            }
            playing += 1;
            if self.held[slot] {
                if oldest.is_none_or(|oldest| self.started_at[slot] < self.started_at[oldest]) {
                    oldest = Some(slot);
                }
            } else if released.is_none_or(|released| self.released_at[slot] < self.released_at[released]) {
                released = Some(slot);
            }
        }
        if playing < self.voices { None } else { released.or(oldest) }
    }

    /// A silent slot, or failing that the one cutting longest (taken over at once).
    fn free_slot(&self, sounding: &impl Fn(usize) -> bool) -> usize {
        let mut fading: Option<usize> = None;
        for slot in 0..self.notes.len() {
            if !self.held[slot] && !sounding(slot) && Some(slot) != self.cut {
                return slot;
            }
            if self.cutting[slot]
                && Some(slot) != self.cut
                && fading.is_none_or(|fading| self.started_at[slot] < self.started_at[fading])
            {
                fading = Some(slot);
            }
        }
        fading.or(self.cut).unwrap_or(0)
    }
}
