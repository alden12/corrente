//! Which voice slot plays each note, for one track (INST-36.5, moved here from the bank's TypeScript
//! by ARCH-10.1). The engine gives a track the plan's voices plus a few spare slots; this picks one for
//! each note on, finds it again for the note off, and says which voice to cut when a new note needs
//! room.
//!
//! - **At most `voices` play at once.** A note past that cuts one: the voice released longest ago (it
//!   is fading anyway), else the held note started longest ago.
//! - **A note already sounding is cut and starts again**, so one key never stacks copies of itself.
//! - **A cut voice fades out over a block** while the new note starts in a spare slot, on time and
//!   without a click. Only if every slot is still fading does a note take one over at once.
//!
//! Its arrays are made when a plan binds, so nothing here allocates while rendering. Times are samples
//! since the track started, which only ever count up. Mono, legato, glide, unison and the sustain
//! pedal (INST-32) come later.
//!
//! Rust notes, for reading this file:
//! - `impl Fn(usize) -> bool` is a function argument: here, the engine answering "is this slot still
//!   sounding?" without the allocator needing the engine itself.
//! - `Option::is_none_or(f)` is `value === undefined || f(value)`.

pub struct VoiceAllocator {
    /// The most that play at once.
    voices: usize,
    /// The slot the last `note_on` needs cut first.
    pub cut: Option<usize>,
    notes: Vec<Option<i32>>,
    velocities: Vec<f32>,
    held: Vec<bool>,
    cutting: Vec<bool>,
    started_at: Vec<u64>,
    released_at: Vec<u64>,
}

impl VoiceAllocator {
    // TS: new VoiceAllocator(slots, voices)
    pub fn new(slots: usize, voices: usize) -> Self {
        VoiceAllocator {
            voices: voices.min(slots),
            cut: None,
            notes: vec![None; slots],
            velocities: vec![0.0; slots],
            held: vec![false; slots],
            cutting: vec![false; slots],
            started_at: vec![0; slots],
            released_at: vec![0; slots],
        }
    }

    /// Engine slots, spares included.
    pub fn slots(&self) -> usize {
        self.notes.len()
    }

    /// The slot to play `note` in from `time`, with `cut` set to a slot to cut first. `sounding` says
    /// whether the engine has a slot busy.
    pub fn note_on(&mut self, note: i32, velocity: f32, time: u64, sounding: impl Fn(usize) -> bool) -> usize {
        self.cut = self.to_cut(note, &sounding);
        if let Some(cut) = self.cut {
            self.cutting[cut] = true;
            self.held[cut] = false;
            self.notes[cut] = None;
        }
        let slot = self.free_slot(&sounding);
        self.notes[slot] = Some(note);
        self.velocities[slot] = velocity;
        self.held[slot] = true;
        self.cutting[slot] = false;
        self.started_at[slot] = time;
        slot
    }

    /// The slot holding `note`, now released, or None if it isn't held (cut, or never started).
    // TS: const slot = slots.find((slot) => notes[slot] === note && held[slot]); if (slot === undefined) return -1; releaseSlot(slot, time); return slot;
    pub fn note_off(&mut self, note: i32, time: u64) -> Option<usize> {
        let slot = (0..self.slots()).find(|&slot| self.notes[slot] == Some(note) && self.held[slot])?;
        self.release_slot(slot, time);
        Some(slot)
    }

    /// Let go of a slot's key (all notes off).
    pub fn release_slot(&mut self, slot: usize, time: u64) {
        self.held[slot] = false;
        self.released_at[slot] = time;
    }

    /// Whether a slot's key is down.
    pub fn is_held(&self, slot: usize) -> bool {
        self.held[slot]
    }

    /// The notes held now, with their velocities: what a new plan starts again.
    // TS: return slots.filter((slot) => held[slot]).map((slot) => ({ note: notes[slot], velocity: velocities[slot] }))
    // `filter_map` keeps each Some its function returns; `?` there skips a slot with no note.
    pub fn held_notes(&self) -> Vec<(i32, f32)> {
        (0..self.slots()).filter(|&slot| self.held[slot]).filter_map(|slot| Some((self.notes[slot]?, self.velocities[slot]))).collect()
    }

    /// The slot to cut before `note` starts: its own copy if it's sounding, or one over the limit.
    fn to_cut(&self, note: i32, sounding: &impl Fn(usize) -> bool) -> Option<usize> {
        let mut playing = 0;
        let (mut released, mut oldest): (Option<usize>, Option<usize>) = (None, None);
        for slot in 0..self.slots() {
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
        for slot in 0..self.slots() {
            if !self.held[slot] && !sounding(slot) && Some(slot) != self.cut {
                return slot;
            }
            if self.cutting[slot] && Some(slot) != self.cut && fading.is_none_or(|fading| self.started_at[slot] < self.started_at[fading]) {
                fading = Some(slot);
            }
        }
        fading.or(self.cut).unwrap_or(0)
    }
}
