//! A track's notes by key and params by value (ARCH-10.1): the per-event work every host needs, here
//! once rather than in each host's own language. Before, the bank's TypeScript did this and told the
//! engine which voice slot played what; now a host says "key 60 down" and "this param is 0.4", and the
//! track picks the slot (voices.rs), the sample zone and the shaped value (binding.rs).
//!
//! - **`bind`**, straight after a load (and a carry), takes the plan's binding and the values, sets
//!   every param source from them, and starts the held notes again in the new plan, unless its voices
//!   carried on, in which case they play on.
//! - **Notes** land `offset` samples into the coming block, as the slot calls do.
//! - **Values** set every source that reads them: ramped (`set_value`), or at once (`init_value`, for
//!   a sample param's slot).
//!
//! Nothing here allocates once bound: notes and values only index arrays bind made.

use super::binding::Binding;
use crate::midi::{Chain, Event};
use super::sampler::Sample;
use super::track::Track;
use super::voices::VoiceAllocator;
use crate::plan::{SIGNAL_END, SIGNAL_ROOT, SIGNAL_SAMPLE, SIGNAL_START};

impl Track {
    /// Bind the plan just loaded: its sources' shaping and zones, and the values they read, `from`
    /// giving any that start elsewhere and ramp to their value over the first block (NaN for none:
    /// how an effect added to a chain fades in from bypassed). False, changing nothing, if there is no
    /// plan or the binding has a different number of sources from it.
    // TS: the second half of bank.ts's load, from `state.plan = plan` on.
    pub(super) fn bind(&mut self, binding: Binding, from: &[f64], sample_rate: i32, samples: &[Option<Sample>]) -> bool {
        // TS: const graph = this.graph; if (!graph || binding.sources.length !== graph.plan.paramCount) return false;
        let Some(graph) = &self.graph else { return false };
        if binding.sources.len() != graph.plan.param_count {
            return false;
        }
        // TS:
        //   const held = this.voicesCarried ? [] : this.voices.heldNotes();
        //   if (!this.voicesCarried) this.voices = new VoiceAllocator(this.voiceSlots(), graph.plan.voiceCount);
        //   this.binding = binding;
        // Voices that carried on keep their slots, so the allocator that placed them stays. Assigning
        // `binding` moves it into the track: the caller can't use it after.
        let held = if self.voices_carried { Vec::new() } else { self.voices.held_notes() };
        if !self.voices_carried {
            self.voices = VoiceAllocator::new(self.voice_slots(), graph.plan.voice_count);
        }
        self.binding = binding;
        // TS: this.binding.sources.forEach((source, index) => { ... }), as a plain loop over indices so
        // each turn can borrow the source and then change the track.
        for index in 0..self.binding.sources.len() {
            // TS:
            //   const raw = this.binding.values[source.value];
            //   const value = resolveNumber(raw, source); const start = isNaN(from[source.value]) ? undefined : resolveNumber(from[source.value], source);
            // Everything is read from `source` first: it borrows the binding, and the setters below need
            // the whole track.
            let source = &self.binding.sources[index];
            let raw = self.binding.values[source.value];
            let (sample, smooth_ms, value, start) = (source.sample, source.smooth_ms, source.shaping.resolve(raw), from[source.value]);
            let start = if start.is_nan() { None } else { Some(source.shaping.resolve(start)) };
            // TS: if (source.smoothMs) eng_param_ramp(track, index, Math.round((source.smoothMs * sampleRate) / 1000))
            if smooth_ms > 0.0 {
                self.set_ramp(index, (smooth_ms * f64::from(sample_rate) / 1000.0 + 0.5).floor() as usize);
            }
            // TS:
            //   if (sample) this.initParam(index, raw);
            //   else if (start === undefined) this.initParam(index, value);
            //   else { this.initParam(index, start); this.setParam(index, value); }
            // Matching on a pair takes the first case that fits; `_` matches anything.
            match (sample, start) {
                (true, _) => self.init_param(index, raw as f32),
                (false, None) => self.init_param(index, value as f32),
                (false, Some(start)) => {
                    self.init_param(index, start as f32);
                    self.set_param(index, value as f32);
                }
            }
        }
        // TS: held.forEach(([note, velocity]) => this.keyOn(0, note, velocity, samples)); return true;
        // `into_iter` hands each item over (the list is used up), rather than lending it.
        held.into_iter().for_each(|(note, velocity)| self.play_on(0, note, f64::from(velocity), samples));
        true
    }

    /// Start `note` (a MIDI note number) at `velocity` (0 to 1), `offset` samples into the coming
    /// block: in the slot the allocator picks, cutting the voice it steals, with the zone it fits. A
    /// note no zone fits doesn't sound, or take a voice.
    // TS: this.midi ? this.midi.key(offset, on(note, velocity)) : this.playOn(offset, note, velocity, samples)
    pub fn key_on(&mut self, offset: i32, note: i32, velocity: f64, samples: &[Option<Sample>]) {
        match &mut self.midi {
            Some(chain) => chain.key(offset, Event::On { note, velocity: velocity as f32, length: None, index: 0 }),
            None => self.play_on(offset, note, velocity, samples),
        }
    }

    /// Start a note in a voice: what `key_on` does with no MIDI devices, and what they play.
    // TS: bank.ts's startNote.
    pub(super) fn play_on(&mut self, offset: i32, note: i32, velocity: f64, samples: &[Option<Sample>]) {
        // TS:
        //   if (this.voices.slots === 0) return;
        //   const start = this.binding.start(note, velocity, samples); if (!start) return;
        //   const time = this.clock + Math.max(offset, 0);
        // `u64::try_from(offset)` fails for a negative offset, which `.unwrap_or(0)` turns into 0.
        if self.voices.slots() == 0 {
            return;
        }
        let Some(start) = self.binding.start(note, velocity, samples) else { return };
        let time = self.clock + u64::try_from(offset).unwrap_or(0);
        // TS: const slot = this.voices.noteOn(note, velocity, time, (slot) => this.graph?.voices[slot]?.active ?? false);
        // `graph` borrows one field while `voices`, another, is changed: Rust allows that.
        let graph = &self.graph;
        let slot = self.voices.note_on(note, velocity as f32, time, |slot| {
            graph.as_ref().and_then(|graph| graph.voices.get(slot)).is_some_and(|voice| voice.active)
        });
        // TS:
        //   if (this.voices.cut !== undefined) this.cut(this.voices.cut, offset);
        //   this.noteOn(slot, offset, start.frequency, start.velocity, note);
        //   if (start.zone) { const [sample, root, from, to] = start.zone; this.setVoiceSignal(slot, SIGNAL_SAMPLE, sample); ... }
        // `if let Some([a, b, c, d]) = x` unpacks the array inside the Option, naming its four items.
        if let Some(cut) = self.voices.cut {
            self.cut(cut, offset);
        }
        self.note_on(slot, offset, start.frequency, start.velocity, note as f32);
        if let Some([sample, root, start, end]) = start.zone {
            self.set_voice_signal(slot, SIGNAL_SAMPLE, sample);
            self.set_voice_signal(slot, SIGNAL_ROOT, root);
            self.set_voice_signal(slot, SIGNAL_START, start);
            self.set_voice_signal(slot, SIGNAL_END, end);
        }
    }

    /// Release `note`, `offset` samples into the coming block, if it's held.
    // TS: this.midi ? this.midi.key(offset, off(note)) : this.playOff(offset, note)
    pub fn key_off(&mut self, offset: i32, note: i32) {
        match &mut self.midi {
            Some(chain) => chain.key(offset, Event::Off { note, index: 0 }),
            None => self.play_off(offset, note),
        }
    }

    /// Release a note's voice: what `key_off` does with no MIDI devices, and what they let go of.
    // TS: const slot = voices.noteOff(note, time); if (slot >= 0) eng_note_off(track, slot, offset);
    pub(super) fn play_off(&mut self, offset: i32, note: i32) {
        // `if let Some(slot) = ...` runs the block only when note_off found a slot.
        let time = self.clock + u64::try_from(offset).unwrap_or(0);
        if let Some(slot) = self.voices.note_off(note, time) {
            self.note_off(slot, offset);
        }
    }

    /// Release every held note, `offset` samples into the coming block.
    // TS: this.midi?.clear(); this.releaseVoices(offset)
    pub fn keys_off(&mut self, offset: i32) {
        if let Some(chain) = &mut self.midi {
            chain.clear();
        }
        self.release_voices(offset);
    }

    /// Replace the track's MIDI devices (None for none). The keys down carry over: what the old chain
    /// (or the voices, with none) was playing lets go, and the keys start again in the new one.
    // TS:
    //   const down = this.midi ? [...this.midi.down()] : this.voices.heldNotes();
    //   this.releaseVoices(0); this.midi = chain; down.forEach(([note, velocity]) => this.keyOn(0, note, velocity, samples));
    pub fn load_midi(&mut self, chain: Option<Chain>, samples: &[Option<Sample>]) {
        let down = match &self.midi {
            Some(old) => old.down().to_vec(),
            None => self.voices.held_notes(),
        };
        self.release_voices(0);
        self.midi = chain;
        down.into_iter().for_each(|(note, velocity)| self.key_on(0, note, f64::from(velocity), samples));
    }

    /// Move a MIDI device value to `raw` (a value the chain doesn't have, or no chain, is ignored).
    // TS: this.midi?.setValue(value, raw)
    pub fn set_midi_value(&mut self, value: usize, raw: f64) {
        if let Some(chain) = &mut self.midi {
            chain.set_value(value, raw);
        }
    }

    /// Release every voice that's held, `offset` samples into the coming block.
    // TS: for (let slot = 0; slot < voices.slots; slot++) if (voices.isHeld(slot)) { voices.releaseSlot(slot, time); eng_note_off(track, slot, offset) }
    fn release_voices(&mut self, offset: i32) {
        let time = self.clock + u64::try_from(offset).unwrap_or(0);
        for slot in 0..self.voices.slots() {
            if self.voices.is_held(slot) {
                self.voices.release_slot(slot, time);
                self.note_off(slot, offset);
            }
        }
    }

    /// Move a value (a param's raw value) to `raw`: every source reading it ramps to its shaped value.
    /// Sample sources are left alone (`init_value` sets those). A value the plan doesn't have is ignored.
    // TS: plan.params.forEach((source, index) => { if (source.param === param && !source.sample) eng_set_param(track, index, resolveNumber(value, source)) })
    pub fn set_value(&mut self, value: usize, raw: f64) {
        // TS: if (value >= this.binding.values.length) return; this.binding.values[value] = raw;
        // `get_mut` lends the item writably; `*slot = raw` writes through the loan.
        let Some(slot) = self.binding.values.get_mut(value) else { return };
        *slot = raw;
        // TS: the forEach above, as a loop over indices (the loop borrows a source, then sets a param).
        for index in 0..self.binding.sources.len() {
            let source = &self.binding.sources[index];
            if source.value == value && !source.sample {
                let shaped = source.shaping.resolve(raw) as f32;
                self.set_param(index, shaped);
            }
        }
    }

    /// Set a value at once, with no ramp: a sample param pointed at a new slot.
    // TS: plan.params.forEach((source, index) => { if (source.param === param) eng_init_param(track, index, source.sample ? raw : resolveNumber(raw, source)) })
    pub fn init_value(&mut self, value: usize, raw: f64) {
        // TS: if (value >= this.binding.values.length) return; this.binding.values[value] = raw;
        let Some(slot) = self.binding.values.get_mut(value) else { return };
        *slot = raw;
        // TS: the forEach above, as a loop over indices.
        for index in 0..self.binding.sources.len() {
            let source = &self.binding.sources[index];
            if source.value == value {
                let shaped = if source.sample { raw } else { source.shaping.resolve(raw) };
                self.init_param(index, shaped as f32);
            }
        }
    }
}
