//! The bank: the engine lib.rs drives, holding every track, the transport and the samples they share.
//! What concerns one track is the track's: lib.rs looks it up with `track` and calls it.

use super::binding::Binding;
use crate::midi::{self, BlockTransport};
use super::sampler::{MAX_SAMPLES, Sample};
use super::track::Track;
use super::{BLOCK, SILENT_SLOT, Slot};
use crate::faust;
use crate::plan::{HOST_BEAT, HOST_BEAT_SAMPLES, HOST_BEAT_SECONDS, HOST_PLAYING, HOST_SAMPLE_RATE, HOST_SIGNALS, HOST_TEMPO, Plan};

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
    /// The samples samplers play, by slot: MAX_SAMPLES slots, each empty or holding one.
    samples: Vec<Option<Sample>>,
}

impl Engine {
    // `const fn` can also run at compile time, which lib.rs needs to set up the
    // one engine before anything calls it.
    pub const fn new() -> Self {
        Engine { sample_rate: 48000, tracks: Vec::new(), transport: (0.0, 120.0, false), host: [SILENT_SLOT; HOST_SIGNALS], samples: Vec::new() }
    }

    /// Set the sample rate and how many tracks the bank has, all silent until a plan loads.
    /// Returns the number of block kinds.
    // TS: init(sampleRate, trackCount) { this.tracks = Array.from({ length: Math.min(trackCount, MAX_TRACKS) }, () => Track.create()); return faust.COUNT }
    pub fn init(&mut self, sample_rate: i32, track_count: usize) -> i32 {
        self.sample_rate = sample_rate;
        self.tracks = (0..track_count.min(MAX_TRACKS)).map(|_| Track::new()).collect();
        // TS: this.samples = new Array(MAX_SAMPLES).fill(undefined). `resize_with` makes the slots
        // here, so filling one later never grows the list mid-render.
        self.samples.clear();
        self.samples.resize_with(MAX_SAMPLES, || None);
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

    /// Bind the plan just loaded into a track (keys.rs) from `eng_bind`'s words. False if there is no
    /// such track or plan, or the words don't make a binding for it (nothing changes).
    // TS: const parsed = Binding.parse(words); return parsed !== undefined && this.tracks[track]?.bind(...parsed, this.sampleRate, this.samples)
    pub fn bind(&mut self, track: usize, words: &[f64]) -> bool {
        let (sample_rate, samples) = (self.sample_rate, &self.samples);
        let (Some(track), Some((binding, from))) = (self.tracks.get_mut(track), Binding::parse(words)) else { return false };
        track.bind(binding, &from, sample_rate, samples)
    }

    /// Start a note on a track by key (keys.rs), which needs the samples to measure a zone's trims.
    // TS: this.tracks[track]?.keyOn(offset, note, velocity, this.samples)
    pub fn key_on(&mut self, track: usize, offset: i32, note: i32, velocity: f64) {
        if let Some(track) = self.tracks.get_mut(track) {
            track.key_on(offset, note, velocity, &self.samples);
        }
    }

    /// Load a track's MIDI devices from `eng_midi_load`'s words (an empty chain, with no devices, takes
    /// them away). False, changing nothing, if there's no such track or the words don't make a chain.
    // TS: const chain = midi.parse(words); if (!chain || !this.tracks[track]) return false; this.tracks[track].loadMidi(chain.devices.length ? chain : undefined, this.samples); return true;
    pub fn load_midi(&mut self, track: usize, words: &[f64]) -> bool {
        let (Some(track), Some(chain)) = (self.tracks.get_mut(track), midi::parse(words)) else { return false };
        let chain = (!chain.devices.is_empty()).then_some(chain);
        track.load_midi(chain, &self.samples);
        true
    }

    /// A track, to read: None if there is no such track. Only the tests read one without changing it.
    // TS: return this.tracks[track]
    // `#[cfg(test)]` builds it into the tests only.
    #[cfg(test)]
    pub fn track(&self, track: usize) -> Option<&Track> {
        self.tracks.get(track)
    }

    /// A track, to play notes on, set params on, or read: None if there is no such track.
    // TS: return this.tracks[track]
    pub fn track_mut(&mut self, track: usize) -> Option<&mut Track> {
        self.tracks.get_mut(track)
    }

    /// Where the transport is at the start of the coming block: the beat, the tempo, and whether it's
    /// playing. JS sets it before each `process`; between calls the beat runs on at the tempo.
    // TS: this.transport = [beat, Math.max(tempo, 1), playing]
    pub fn set_transport(&mut self, beat: f64, tempo: f32, playing: bool) {
        self.transport = (beat, tempo.max(1.0), playing);
    }

    /// Make room for a sample in `slot`, replacing any there, and lend JS the memory to write it into:
    /// each channel's frames in turn. None for a slot that doesn't exist or a sample that won't fit.
    // TS: const sample = Sample.create(frames, channels, rate); if (!sample || slot >= this.samples.length) return undefined; this.samples[slot] = sample; return sample.data;
    // `*entry = Some(sample)` frees whatever the slot held before. `.as_mut()` then lends the new
    // sample back out of its Option, writably.
    pub fn reserve_sample(&mut self, slot: usize, frames: usize, channels: usize, rate: f32) -> Option<&mut [f32]> {
        let entry = self.samples.get_mut(slot)?;
        *entry = Some(Sample::new(frames, channels, rate)?);
        entry.as_mut().map(Sample::data_mut)
    }

    /// Empty a sample slot, freeing its memory. A sampler still pointing at it plays silence.
    // TS: if (this.samples[slot] !== undefined) this.samples[slot] = undefined
    pub fn free_sample(&mut self, slot: usize) {
        if let Some(entry) = self.samples.get_mut(slot) {
            *entry = None;
        }
    }

    /// Render one block of every track, after filling the host signals for it.
    // TS: this.fillHost(); this.tracks.forEach((track) => track.process(this.host)); this.transport[0] += beatsPerBlock;
    pub fn process(&mut self) {
        self.fill_host();
        let (host, samples) = (&self.host, &self.samples);
        let (beat, tempo, playing) = self.transport;
        let block = BlockTransport { beat, per_sample: tempo as f64 / 60.0 / self.sample_rate as f64, playing };
        self.tracks.iter_mut().for_each(|track| track.process(host, samples, block));
        self.transport = (beat + BLOCK as f64 * tempo as f64 / 60.0 / self.sample_rate as f64, tempo, playing);
    }

    /// The host signals for the coming block: the beat ramps across it, the rest hold.
    // TS:
    //   const [beat, tempo, playing] = this.transport;
    //   const perSample = tempo / 60 / this.sampleRate;
    //   for (const signal of this.host) signal[0] = signal[BLOCK];  // the sample before, for feedback edges
    //   this.host[HOST_BEAT].forEach((_, i) => i > 0 && (this.host[HOST_BEAT][i] = beat + (i - 1) * perSample));
    //   and the others filled with tempo, playing (0 or 1), 60 / tempo, 60 * sampleRate / tempo, and sampleRate.
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
        self.host[HOST_SAMPLE_RATE][1..].fill(self.sample_rate as f32);
    }
}
