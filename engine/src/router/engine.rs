//! The bank: the engine lib.rs drives, holding every track and passing each call to the one it names.

use super::track::Track;
use super::{BLOCK, SILENT_SLOT, Slot};
use crate::faust;
use crate::plan::{HOST_BEAT, HOST_BEAT_SAMPLES, HOST_BEAT_SECONDS, HOST_PLAYING, HOST_SIGNALS, HOST_TEMPO, Plan};

/// The most tracks one engine runs (a bank; a phone wants about 16).
pub const MAX_TRACKS: usize = 64;

// Fields are private unless marked `pub`; only `Engine` itself is public.
pub struct Engine {
    sample_rate: i32,
    tracks: Vec<Track>,
    /// The transport at the start of the coming block: beat, tempo (beats a minute), playing.
    transport: (f64, f32, bool),
    /// The host signals for the block, filled from `transport` and shared by every track.
    host: [Slot; HOST_SIGNALS],
}

impl Engine {
    // `const fn` can also run at compile time, which lib.rs needs to set up the
    // one engine before anything calls it.
    pub const fn new() -> Self {
        Engine { sample_rate: 48000, tracks: Vec::new(), transport: (0.0, 120.0, false), host: [SILENT_SLOT; HOST_SIGNALS] }
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

    // TS: this.tracks[track]?.noteOn(slot, offset, frequency, velocity, note)
    pub fn note_on(&mut self, track: usize, slot: usize, offset: i32, frequency: f32, velocity: f32, note: f32) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.note_on(slot, offset, frequency, velocity, note);
        }
    }

    // TS: this.tracks[track]?.noteOff(slot, offset)
    pub fn note_off(&mut self, track: usize, slot: usize, offset: i32) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.note_off(slot, offset);
        }
    }

    /// Fade a voice out and free it: see `Track::cut`.
    // TS: this.tracks[track]?.cut(slot, offset)
    pub fn cut(&mut self, track: usize, slot: usize, offset: i32) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.cut(slot, offset);
        }
    }

    /// How many voice slots a track's plan has, spares included.
    // TS: return this.tracks[track]?.voiceSlots()
    pub fn voice_slots(&self, track: usize) -> Option<usize> {
        self.tracks.get(track).map(|track| track.voice_slots())
    }

    // TS: return this.tracks[track]?.voiceActive(slot) ?? false
    // `.is_some_and(f)` is `x !== undefined && f(x)`.
    pub fn voice_active(&self, track: usize, slot: usize) -> bool {
        self.tracks.get(track).is_some_and(|track| track.voice_active(slot))
    }

    /// Where the transport is at the start of the coming block: the beat, the tempo, and whether it's
    /// playing. JS sets it before each `process`; between calls the beat runs on at the tempo.
    // TS: this.transport = [beat, Math.max(tempo, 1), playing]
    pub fn set_transport(&mut self, beat: f64, tempo: f32, playing: bool) {
        self.transport = (beat, tempo.max(1.0), playing);
    }

    /// Render one block of every track, after filling the host signals for it.
    // TS: this.fillHost(); this.tracks.forEach((track) => track.process(this.host)); this.transport[0] += beatsPerBlock;
    pub fn process(&mut self) {
        self.fill_host();
        let host = &self.host;
        self.tracks.iter_mut().for_each(|track| track.process(host));
        let (beat, tempo, playing) = self.transport;
        self.transport = (beat + BLOCK as f64 * tempo as f64 / 60.0 / self.sample_rate as f64, tempo, playing);
    }

    /// The host signals for the coming block: the beat ramps across it, the rest hold.
    // TS:
    //   const [beat, tempo, playing] = this.transport;
    //   const perSample = tempo / 60 / this.sampleRate;
    //   for (const signal of this.host) signal[0] = signal[BLOCK];  // the sample before, for feedback edges
    //   this.host[HOST_BEAT].forEach((_, i) => i > 0 && (this.host[HOST_BEAT][i] = beat + (i - 1) * perSample));
    //   and the others filled with tempo, playing (0 or 1), 60 / tempo, and 60 * sampleRate / tempo.
    fn fill_host(&mut self) {
        let (beat, tempo, playing) = self.transport;
        let per_sample = tempo as f64 / 60.0 / self.sample_rate as f64;
        self.host.iter_mut().for_each(|signal| signal[0] = signal[BLOCK]);
        self.host[HOST_BEAT][1..].iter_mut().enumerate().for_each(|(index, sample)| *sample = (beat + index as f64 * per_sample) as f32);
        // `[1..].fill(x)` fills this block's samples, leaving slot 0 (the sample before) alone.
        self.host[HOST_TEMPO][1..].fill(tempo);
        self.host[HOST_PLAYING][1..].fill(if playing { 1.0 } else { 0.0 });
        self.host[HOST_BEAT_SECONDS][1..].fill(60.0 / tempo);
        self.host[HOST_BEAT_SAMPLES][1..].fill(60.0 * self.sample_rate as f32 / tempo);
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
