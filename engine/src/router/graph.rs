//! A track's graph: a plan and everything it runs on (its params, its pre and post sections' state,
//! and its voices), and how it renders a block: the pre section, every sounding voice summed, then
//! the post section.

use super::params::ParamSource;
use super::render::{Render, Unit};
use super::sampler::Sample;
use super::sources::{Context, Sources};
use super::{BLOCK, NO_SIGNALS, NO_VOICE_SUM, SILENCE, SILENT_SLOT, SLOT, Slot};
use crate::plan::{CHANNELS, HOST_SIGNALS, MAX_INPUTS, Plan, SIGNAL_VELOCITY, Section, VOICE_SIGNALS};

/// One section's state, in a track or in one voice: a unit per node and a buffer per node output.
pub(super) struct SectionState {
    pub(super) units: Vec<Unit>,
    pub(super) buffers: Vec<Slot>,
}

pub(super) struct Voice {
    pub(super) state: SectionState,
    pub(super) signals: [Slot; VOICE_SIGNALS],
    pub(super) current: [f32; VOICE_SIGNALS],
    pub(super) active: bool,
    pub(super) released: bool,
    /// Being cut: fading out from sample `cut_from` of this block, at `cut_gain` when it starts.
    pub(super) cutting: bool,
    pub(super) cut_from: usize,
    pub(super) cut_gain: f32,
}

/// Slots a graph has beyond its plan's voices, for notes that start while stolen ones fade.
pub(super) const SPARE_VOICES: usize = 4;

/// The voice slots for a plan of `voices` voices: those and the spares, or none for a plan with no
/// voices (an effect), which has no notes to steal for.
// TS: const slotsFor = (voices: number) => (voices === 0 ? 0 : voices + SPARE_VOICES);
fn slots_for(voices: usize) -> usize {
    if voices == 0 { 0 } else { voices + SPARE_VOICES }
}
/// How long a cut voice takes to fade out, in samples.
const CUT: usize = BLOCK;

/// A plan and everything it runs on. A track has one, and for the block after a load, the one it
/// replaced, fading out.
pub(super) struct Graph {
    pub(super) plan: Plan,
    pub(super) params: Vec<ParamSource>,
    pub(super) constants: Vec<Slot>,
    pub(super) pre: SectionState,
    pub(super) post: SectionState,
    pub(super) voices: Vec<Voice>,
}

/// One block of a track's stereo output.
pub(super) type Output = [[f32; BLOCK]; CHANNELS];

impl SectionState {
    /// A unit and buffers for every node; `constants` are the plan's literals (a delay's size).
    pub(super) fn new(section: &Section, sample_rate: i32, constants: &[f32]) -> Self {
        SectionState {
            units: section.nodes.iter().map(|node| Unit::new(node, sample_rate, constants)).collect(),
            // TS: Array.from({ length: section.bufferCount }, () => new Float32Array(SLOT))
            buffers: vec![SILENT_SLOT; section.buffer_count],
        }
    }

    // TS: clear() { this.units.forEach((unit) => unit.clear()); this.buffers.forEach((buffer) => buffer.fill(0)) }
    // `iter_mut()` hands out writable loans of each item; `Unit::clear` names the method as a function.
    pub(super) fn clear(&mut self) {
        self.units.iter_mut().for_each(Unit::clear);
        self.buffers.iter_mut().for_each(|buffer| buffer.fill(0.0));
    }

    /// Carry each buffer's last sample into slot 0, for feedback edges in the next block.
    // TS: this.buffers.forEach((buffer) => (buffer[0] = buffer[BLOCK]))
    pub(super) fn carry(&mut self) {
        self.buffers.iter_mut().for_each(|buffer| buffer[0] = buffer[BLOCK]);
    }
}

impl Voice {
    fn new(section: &Section, sample_rate: i32, constants: &[f32]) -> Self {
        Voice {
            state: SectionState::new(section, sample_rate, constants),
            signals: [SILENT_SLOT; VOICE_SIGNALS],
            current: [0.0; VOICE_SIGNALS],
            active: false,
            released: false,
            cutting: false,
            cut_from: 0,
            cut_gain: 1.0,
        }
    }

    /// The cut's gain at sample `index` of this block: 1 until it starts, then down to 0 over CUT.
    // TS: return !this.cutting || index < this.cutFrom ? this.cutGain : Math.max(0, this.cutGain - (index - this.cutFrom + 1) / CUT)
    pub(super) fn cut_at(&self, index: usize) -> f32 {
        if !self.cutting || index < self.cut_from {
            return self.cut_gain;
        }
        (self.cut_gain - (index - self.cut_from + 1) as f32 / CUT as f32).max(0.0)
    }

    /// Set a signal to `value` from sample `from` + 1 on (from = -1 sets the whole slot).
    // TS: this.signals[signal].fill(value, Math.min(Math.max(from + 1, 0), SLOT)); this.current[signal] = value;
    // `[first..]` is the part of the array from `first` to the end, still writable, so `.fill`
    // writes into the original.
    pub(super) fn fill_signal(&mut self, signal: usize, from: i32, value: f32) {
        let first = usize::try_from(from + 1).unwrap_or(0).min(SLOT);
        self.signals[signal][first..].fill(value);
        self.current[signal] = value;
    }
}

impl Graph {
    pub(super) fn new(plan: Plan, sample_rate: i32) -> Self {
        Graph {
            params: vec![ParamSource::default(); plan.param_count],
            // TS: plan.constants.map((value) => new Float32Array(SLOT).fill(value))
            constants: plan.constants.iter().map(|&value| [value; SLOT]).collect(),
            pre: SectionState::new(&plan.pre, sample_rate, &plan.constants),
            post: SectionState::new(&plan.post, sample_rate, &plan.constants),
            voices: (0..slots_for(plan.voice_count)).map(|_| Voice::new(&plan.voice, sample_rate, &plan.constants)).collect(),
            plan,
        }
    }

    /// Render one block into `output`: pre, then every sounding voice into `voice_sum`, then post.
    // Taking the track's `inputs` and `voice_sum` as arguments lets two graphs share them in turn.
    pub(super) fn render(&mut self, inputs: &[Slot; MAX_INPUTS], host: &[Slot; HOST_SIGNALS], samples: &[Option<Sample>], voice_sum: &mut [Slot; CHANNELS], output: &mut Output) {
        // TS: this.params.forEach((param) => param.advance())
        self.params.iter_mut().for_each(ParamSource::advance);
        // TS: voiceSum.forEach((channel) => channel.fill(0))
        voice_sum.iter_mut().for_each(|channel| channel.fill(0.0));
        let plan = &self.plan;

        // Rust lets one function hold loans of different fields of `self` at once (`self.params` read,
        // `self.pre` written), since they can't overlap. These loans all end with the function.
        let context = Context {
            shared: &[],
            shared_base: &[],
            signals: &NO_SIGNALS,
            voice_sum: &NO_VOICE_SUM,
            inputs,
            host,
            params: &self.params,
            constants: &self.constants,
            samples,
        };
        Render { section: &plan.pre, units: &mut self.pre.units, buffers: &mut self.pre.buffers, context }.run();

        // TS: { ...context, shared: this.pre.buffers, sharedBase: plan.pre.base }. `..context` is the spread.
        let shared = Context { shared: &self.pre.buffers, shared_base: &plan.pre.base, ..context };
        // TS: for (const voice of this.voices.filter((voice) => voice.active))
        for voice in self.voices.iter_mut().filter(|voice| voice.active) {
            let voice_context = Context { signals: &voice.signals, ..shared };
            Render { section: &plan.voice, units: &mut voice.state.units, buffers: &mut voice.state.buffers, context: voice_context }.run();
            // Velocity scales the voice on the way into the sum, as the Web Audio engine's `amp` does,
            // and so does a cut's fade.
            let sources = Sources::whole(&plan.voice.base, &voice.state.buffers, voice_context);
            let velocity = &voice.signals[SIGNAL_VELOCITY][1..];
            // `0.0f32` is a literal typed as f32.
            let mut peak = 0.0f32;
            // TS: for each channel: the source for it (a mono output plays in both), summed in.
            // `.or(x)` on an Option: itself if Some, else x. `let Some(&source) = ... else { return }`
            // skips a channel with no source (a voice with no output).
            // `voice` is lent to the closure to read its cut while `voice_sum` is written: the
            // compiler checks those two never overlap.
            let fading = &*voice;
            voice_sum.iter_mut().enumerate().for_each(|(channel, sum)| {
                let Some(&source) = plan.voice_out.get(channel).or(plan.voice_out.first()) else { return };
                let samples = sources.samples(source, 0, BLOCK);
                sum[1..].iter_mut().zip(samples).zip(velocity).enumerate().for_each(|(index, ((mixed, &sample), &gain))| {
                    *mixed += sample * gain * fading.cut_at(index);
                    peak = peak.max(sample.abs());
                });
            });
            voice.state.carry();
            // TS: each signal refilled with its current value for the next block.
            voice.signals.iter_mut().zip(voice.current).for_each(|(signal, value)| signal.fill(value));
            // TS: if (voice.cutting) { voice.cutGain = voice.cutAt(BLOCK - 1); voice.cutFrom = 0; if (voice.cutGain === 0) voice.active = false }
            if voice.cutting {
                voice.cut_gain = voice.cut_at(BLOCK - 1);
                voice.cut_from = 0;
                if voice.cut_gain == 0.0 {
                    voice.active = false;
                }
            }
            if voice.released && peak < SILENCE {
                voice.active = false;
            }
        }

        let post_context = Context { voice_sum: &*voice_sum, ..shared };
        Render { section: &plan.post, units: &mut self.post.units, buffers: &mut self.post.buffers, context: post_context }.run();
        let sources = Sources::whole(&plan.post.base, &self.post.buffers, post_context);
        // TS: output.forEach((channel, i) => { const source = trackOut[i] ?? trackOut[0]; channel.set(source ? sources.samples(source, 0, BLOCK) : silence) })
        output.iter_mut().enumerate().for_each(|(channel, output)| match plan.track_out.get(channel).or(plan.track_out.first()) {
            Some(&source) => output.copy_from_slice(sources.samples(source, 0, BLOCK)),
            None => output.fill(0.0),
        });
        self.pre.carry();
        self.post.carry();
    }

    // TS: return this.voices.some((voice) => voice.active)
    pub(super) fn sounding(&self) -> bool {
        self.voices.iter().any(|voice| voice.active)
    }
}
