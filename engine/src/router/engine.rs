//! The bank: the engine lib.rs drives, holding every track and passing each call to the one it names.

use super::track::Track;
use super::BLOCK;
use crate::faust;
use crate::plan::Plan;

/// The most tracks one engine runs (a bank; a phone wants about 16).
pub const MAX_TRACKS: usize = 64;

// Fields are private unless marked `pub`; only `Engine` itself is public.
pub struct Engine {
    sample_rate: i32,
    tracks: Vec<Track>,
}

impl Engine {
    // `const fn` can also run at compile time, which lib.rs needs to set up the
    // one engine before anything calls it.
    pub const fn new() -> Self {
        Engine { sample_rate: 48000, tracks: Vec::new() }
    }

    /// Set the sample rate and how many tracks the bank has, all silent until a plan loads.
    /// Returns the number of block kinds.
    // TS: init(sampleRate, trackCount) { this.tracks = Array.from({ length: Math.min(trackCount, MAX_TRACKS) }, () => Track.create()); return faust.COUNT }
    pub fn init(&mut self, sample_rate: i32, track_count: usize) -> i32 {
        self.sample_rate = sample_rate;
        self.tracks = (0..track_count.min(MAX_TRACKS)).map(|_| Track::new()).collect();
        faust::COUNT as i32
    }

    /// Load a plan into a track. False if there is no such track (the plan is dropped).
    // TS: const track = this.tracks[track]; if (!track) return false; track.load(plan, this.sampleRate); return true;
    // `let sample_rate = self.sample_rate` first: reading `self.sample_rate` while `track` holds a
    // writable loan of `self.tracks` is fine (different fields), but naming it first reads clearer.
    pub fn load(&mut self, track: usize, plan: Plan) -> bool {
        let sample_rate = self.sample_rate;
        let Some(track) = self.tracks.get_mut(track) else { return false };
        track.load(plan, sample_rate);
        true
    }

    /// Set a track param's value; it ramps there over the next block.
    // TS: this.tracks[track]?.setParam(source, value)
    pub fn set_param(&mut self, track: usize, source: usize, value: f32) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.set_param(source, value);
        }
    }

    /// Jump a track param to a value with no ramp (initial values).
    // TS: this.tracks[track]?.initParam(source, value)
    pub fn init_param(&mut self, track: usize, source: usize, value: f32) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.init_param(source, value);
        }
    }

    // TS: this.tracks[track]?.noteOn(slot, offset, frequency, velocity)
    pub fn note_on(&mut self, track: usize, slot: usize, offset: i32, frequency: f32, velocity: f32) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.note_on(slot, offset, frequency, velocity);
        }
    }

    // TS: this.tracks[track]?.noteOff(slot, offset)
    pub fn note_off(&mut self, track: usize, slot: usize, offset: i32) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.note_off(slot, offset);
        }
    }

    // TS: return this.tracks[track]?.voiceActive(slot) ?? false
    // `.is_some_and(f)` is `x !== undefined && f(x)`.
    pub fn voice_active(&self, track: usize, slot: usize) -> bool {
        self.tracks.get(track).is_some_and(|track| track.voice_active(slot))
    }

    /// Render one block of every track.
    // TS: this.tracks.forEach((track) => track.process())
    // `Track::process` names the method as a function, so it can be passed like `(track) => track.process()`.
    pub fn process(&mut self) {
        self.tracks.iter_mut().for_each(Track::process);
    }

    /// A track's output channel for the block just rendered.
    // TS: return this.tracks[track]?.output(channel)
    // `.and_then(f)` chains a second lookup that may also come up empty, like `?.`.
    pub fn output(&self, track: usize, channel: usize) -> Option<&[f32; BLOCK]> {
        self.tracks.get(track).and_then(|track| track.output(channel))
    }

    /// A track's audio input channel, for the next block, to be written before `process`.
    // TS: return this.tracks[track]?.inputMut(channel)
    pub fn input_mut(&mut self, track: usize, channel: usize) -> Option<&mut [f32]> {
        self.tracks.get_mut(track).and_then(|track| track.input_mut(channel))
    }

    /// The loudest sample in a track's output channel last block.
    // TS: return this.tracks[track]?.peak(channel)
    pub fn peak(&self, track: usize, channel: usize) -> Option<f32> {
        self.tracks.get(track).and_then(|track| track.peak(channel))
    }

    /// Whether a track was silent last block (no voice sounding, nothing out).
    pub fn silent(&self, track: usize) -> Option<bool> {
        self.tracks.get(track).map(|track| track.silent())
    }

    /// How many samples late a track's output is, from its plan.
    pub fn latency(&self, track: usize) -> Option<usize> {
        self.tracks.get(track).map(|track| track.latency())
    }

    /// What a node's meter shows: see `Track::meter`.
    pub fn meter(&self, track: usize, section: usize, node: usize, index: usize) -> Option<f32> {
        self.tracks.get(track).and_then(|track| track.meter(section, node, index))
    }
}
