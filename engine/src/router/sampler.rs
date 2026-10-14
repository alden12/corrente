//! The native sample player (`KIND_SAMPLER`, INST-36.6): it reads audio the engine holds, which
//! Faust's Rust backend can't (it has no `soundfile`).
//!
//! - **Samples** live in the bank, in numbered slots JS fills (`eng_sample_reserve`) and empties
//!   (`eng_sample_free`), outside rendering. A sampler names its slot with its `sample` control.
//! - **A note starts it:** each rise of `gate` plays from `start`. It reads `frequency / root` times
//!   faster than the sample's own speed (corrected for the two sample rates), so pitch and length
//!   move together, as in any classic sampler. The read position is kept apart from that rate, so a
//!   stretch mode (INST-7) can change one without the other later.
//! - **It stops at `end`**, or with `loop` on, jumps back to `start`. Released notes go on playing:
//!   one-shot or held is the definition's envelope, not the player's.
//! - **Between samples it interpolates** over four neighbours (a cubic through them), so a sample
//!   played far from its root stays clean.
//!
//! Rust notes, for reading this file:
//! - `Box<[f32]>` is a fixed-length array on the heap, like a Float32Array: made once when JS reserves
//!   the slot, so rendering never allocates.
//! - `f64` is a 64-bit float (JS's number). The read position is one: an f32 runs out of precision
//!   to count fractions of a sample a few minutes into a long sample.

use super::render::{Render, Unit};
use crate::plan::SAMPLER_CONTROLS;

/// How many samples a bank holds at once.
pub const MAX_SAMPLES: usize = 256;
/// The most floats one sample may take (frames times channels): 64MB, about 3 minutes of stereo.
pub const MAX_SAMPLE_FLOATS: usize = 1 << 24;

// The sampler's controls, in the order a plan gives them.
const CONTROL_SAMPLE: usize = 0;
const CONTROL_ROOT: usize = 1;
const CONTROL_START: usize = 2;
const CONTROL_END: usize = 3;
const CONTROL_LOOP: usize = 4;

/// One sample: one or two channels, one after the other, at its own sample rate.
pub struct Sample {
    frames: usize,
    channels: usize,
    rate: f32,
    data: Box<[f32]>,
}

impl Sample {
    /// A silent sample, for JS to write into. None for one too big, or with no frames or channels.
    // TS: static create(frames, channels, rate) { return frames > 0 && ... ? { frames, channels, rate, data: new Float32Array(frames * channels) } : undefined }
    pub fn new(frames: usize, channels: usize, rate: f32) -> Option<Self> {
        let floats = frames.checked_mul(channels)?;
        let fits = frames > 0 && (1..=2).contains(&channels) && floats <= MAX_SAMPLE_FLOATS && rate > 0.0;
        // `bool.then(|| x)` is `cond ? x : undefined`.
        fits.then(|| Sample { frames, channels, rate, data: vec![0.0; floats].into_boxed_slice() })
    }

    /// Where JS writes the audio: channel 0's frames, then channel 1's.
    pub fn data_mut(&mut self) -> &mut [f32] {
        &mut self.data
    }

    /// Channel `channel` at `position` frames in, interpolated (a mono sample's one channel for either).
    // TS: const at = (frame) => data[channelStart + clamp(frame, 0, frames - 1)]; then the cubic.
    fn read(&self, channel: usize, position: f64) -> f32 {
        let start = channel.min(self.channels - 1) * self.frames;
        let frames = &self.data[start..start + self.frames];
        let whole = position.floor();
        let fraction = (position - whole) as f32;
        // `as isize` keeps it signed, since the frame before the first is -1.
        let at = |offset: isize| frames[(whole as isize + offset).clamp(0, self.frames as isize - 1) as usize];
        hermite(at(-1), at(0), at(1), at(2), fraction)
    }
}

/// The value `fraction` of the way from `b` to `c`, on a smooth curve through `a`, `b`, `c` and `d`
/// (a Catmull-Rom cubic: cheap, and far less dull than a straight line between the two).
fn hermite(a: f32, b: f32, c: f32, d: f32, fraction: f32) -> f32 {
    let slope_b = (c - a) * 0.5;
    let slope_c = (d - b) * 0.5;
    let rise = c - b;
    let cubic = slope_b + slope_c - 2.0 * rise;
    let square = 3.0 * rise - 2.0 * slope_b - slope_c;
    ((cubic * fraction + square) * fraction + slope_b) * fraction + b
}

/// A sampler node's state, one per voice.
pub(super) struct SamplerState {
    sample_rate: f64,
    /// The controls as last read: sample slot, root note, start, end, loop.
    controls: [f32; SAMPLER_CONTROLS],
    /// The root note's frequency, worked out when the controls are read rather than every sample.
    root_frequency: f64,
    /// Where it is reading, in the sample's frames.
    position: f64,
    playing: bool,
    /// The gate's last sample, to see it rise.
    gate: f32,
}

impl SamplerState {
    pub(super) fn new(sample_rate: i32) -> Self {
        let mut state = SamplerState {
            sample_rate: sample_rate as f64,
            controls: [0.0, 60.0, 0.0, 1.0, 0.0],
            root_frequency: 0.0,
            position: 0.0,
            playing: false,
            gate: 0.0,
        };
        state.set_root();
        state
    }

    // TS: clear() { this.position = 0; this.playing = false; this.gate = 0 }
    pub(super) fn clear(&mut self) {
        self.position = 0.0;
        self.playing = false;
        self.gate = 0.0;
    }

    // TS: this.rootFrequency = 440 * 2 ** ((this.controls[ROOT] - 69) / 12)
    fn set_root(&mut self) {
        self.root_frequency = 440.0 * 2f64.powf((self.controls[CONTROL_ROOT] as f64 - 69.0) / 12.0);
    }

    /// Play `frequencies` and `gates` into `left` and `right` from `samples`.
    fn play(&mut self, samples: &[Option<Sample>], frequencies: &[f32], gates: &[f32], left: &mut [f32], right: &mut [f32]) {
        // TS: const sample = samples[Math.round(controls[SAMPLE])]; if (!sample) { left.fill(0); right.fill(0); return }
        // `.get(i)` then `?.as_ref()`-like `.and_then(Option::as_ref)`: the slot, if it exists and holds a sample.
        let slot = self.controls[CONTROL_SAMPLE].round().max(0.0) as usize;
        let Some(sample) = samples.get(slot).and_then(Option::as_ref) else {
            left.fill(0.0);
            right.fill(0.0);
            return;
        };
        let frames = sample.frames as f64;
        let start = (self.controls[CONTROL_START].clamp(0.0, 1.0) as f64) * frames;
        let end = (self.controls[CONTROL_END].clamp(0.0, 1.0) as f64) * frames;
        let looping = self.controls[CONTROL_LOOP] >= 0.5 && end > start;
        let mono = sample.channels == 1;
        // Frames of the sample per output sample at the root note: more if it was recorded faster.
        let rates = sample.rate as f64 / self.sample_rate;
        // TS: for (let i = 0; i < gates.length; i++) { ... }
        // Four lists zipped: `((frequency, gate), (left, right))` pairs of pairs.
        frequencies.iter().zip(gates).zip(left.iter_mut().zip(right.iter_mut())).for_each(|((&frequency, &gate), (left, right))| {
            if gate > 0.0 && self.gate <= 0.0 {
                self.position = start;
                self.playing = end > start;
            }
            self.gate = gate;
            if self.playing && self.position >= end {
                // `%` on floats is the remainder, as in JS: a big step still lands inside the loop.
                if looping { self.position = start + (self.position - start) % (end - start) } else { self.playing = false }
            }
            // TS: [left, right] = !playing ? [0, 0] : mono ? [read(0), read(0)] : [read(0), read(1)]
            *left = if self.playing { sample.read(0, self.position) } else { 0.0 };
            *right = if !self.playing { 0.0 } else if mono { *left } else { sample.read(1, self.position) };
            // Dividing by the root rather than multiplying by its inverse keeps a note an exact
            // number of octaves away an exact speed, so a sample ends exactly at its end.
            if self.playing {
                self.position += frequency.max(0.0) as f64 / self.root_frequency * rates;
            }
        });
    }
}

// The sampler's methods on Render. The rest are in render.rs.
impl Render<'_> {
    /// Run a sampler over [start, start + length), reading its controls first if `set_controls`.
    pub(super) fn run_sampler(&mut self, index: usize, start: usize, length: usize, set_controls: bool) {
        let samples = self.context.samples;
        self.with_node(index, start, |node, unit, outputs, sources| {
            // TS: if (unit.type !== "sampler") return; const state = unit.state;
            let Unit::Sampler(state) = unit else { return };
            if set_controls {
                // TS: node.control.forEach((source, i) => (state.controls[i] = sources.samples(source, start, 1)[0]))
                state.controls.iter_mut().zip(&node.control).for_each(|(control, &source)| *control = sources.samples(source, start, 1)[0]);
                state.set_root();
            }
            let frequencies = sources.samples(node.audio[0], start, length);
            let gates = sources.samples(node.audio[1], start, length);
            // The two outputs are two buffers side by side; `split_at_mut` lends each writably.
            let (left, right) = outputs.split_at_mut(1);
            state.play(samples, frequencies, gates, &mut left[0][start + 1..start + 1 + length], &mut right[0][start + 1..start + 1 + length]);
        });
    }
}
