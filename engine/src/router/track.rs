//! One track of the bank: its plan, params and voices, and the block it renders: the pre section,
//! every sounding voice summed, then the post section, into a stereo output.

use super::render::{Render, Unit};
use super::sources::{Context, Sources};
use super::{BLOCK, NO_SIGNALS, NO_VOICE_SUM, SILENCE, SILENT_SLOT, SLOT, Slot};
use crate::plan::{CHANNELS, MAX_INPUTS, Plan, SIGNAL_FREQ, SIGNAL_GATE, SIGNAL_VELOCITY, Section, VOICE_SIGNALS};

/// One section's state, in a track or in one voice: a unit per node and a buffer per node output.
// TS: interface SectionState { units: Unit[]; buffers: Slot[] }
struct SectionState {
    units: Vec<Unit>,
    buffers: Vec<Slot>,
}

// TS: interface Voice { state: SectionState; signals: [Slot, Slot, Slot]; current: [number, number, number]; active: boolean; released: boolean }
struct Voice {
    state: SectionState,
    signals: [Slot; VOICE_SIGNALS],
    current: [f32; VOICE_SIGNALS],
    active: bool,
    released: bool,
}

/// A param's smoothed buffer: it ramps from `current` to `target` over each block.
// `Clone` lets `vec![ParamSource::default(); n]` copy it n times; it isn't `Copy` (copied
// implicitly) because a 129-float array is too big to copy without saying so.
#[derive(Clone)]
pub(super) struct ParamSource {
    current: f32,
    target: f32,
    pub(super) buffer: Slot,
}

// TS: static default(): ParamSource { return { current: 0, target: 0, buffer: new Float32Array(SLOT) } }
// `Default` is a standard trait for "a sensible starting value". `Self` is the type being implemented.
impl Default for ParamSource {
    fn default() -> Self {
        Self { current: 0.0, target: 0.0, buffer: SILENT_SLOT }
    }
}

/// One track of the bank: its plan, and everything that plan runs on.
// TS: interface Track { plan?: Plan; params: ParamSource[]; ...; inputs: Slot[]; output: [Float32Array, Float32Array] }
// `inputs` and `output` sit inside the track, so they stay at one address while the bank exists:
// JS is handed pointers to them once.
pub(super) struct Track {
    plan: Option<Plan>,
    params: Vec<ParamSource>,
    constants: Vec<Slot>,
    pre: SectionState,
    post: SectionState,
    voices: Vec<Voice>,
    voice_sum: [Slot; CHANNELS],
    inputs: [Slot; MAX_INPUTS],
    output: [[f32; BLOCK]; CHANNELS],
}

impl SectionState {
    // TS: static create(section: Section, sampleRate: number): SectionState
    fn new(section: &Section, sample_rate: i32) -> Self {
        SectionState {
            units: section.nodes.iter().map(|node| Unit::new(node, sample_rate)).collect(),
            // TS: Array.from({ length: section.bufferCount }, () => new Float32Array(SLOT))
            buffers: vec![SILENT_SLOT; section.buffer_count],
        }
    }

    // TS: static empty(): SectionState { return { units: [], buffers: [] } }
    fn empty() -> Self {
        SectionState { units: Vec::new(), buffers: Vec::new() }
    }

    // TS: clear() { this.units.forEach((unit) => unit.clear()); this.buffers.forEach((buffer) => buffer.fill(0)) }
    // `iter_mut()` hands out writable loans of each item; `Unit::clear` names the method as a function.
    fn clear(&mut self) {
        self.units.iter_mut().for_each(Unit::clear);
        self.buffers.iter_mut().for_each(|buffer| buffer.fill(0.0));
    }

    /// Carry each buffer's last sample into slot 0, for feedback edges in the next block.
    // TS: this.buffers.forEach((buffer) => (buffer[0] = buffer[BLOCK]))
    fn carry(&mut self) {
        self.buffers.iter_mut().for_each(|buffer| buffer[0] = buffer[BLOCK]);
    }
}

impl Voice {
    // TS: static create(section: Section, sampleRate: number): Voice
    fn new(section: &Section, sample_rate: i32) -> Self {
        Voice {
            state: SectionState::new(section, sample_rate),
            signals: [SILENT_SLOT; VOICE_SIGNALS],
            current: [0.0; VOICE_SIGNALS],
            active: false,
            released: false,
        }
    }

    /// Set a signal to `value` from sample `from` + 1 on (from = -1 sets the whole slot).
    // TS: this.signals[signal].fill(value, Math.min(Math.max(from + 1, 0), SLOT)); this.current[signal] = value;
    // `[first..]` is the part of the array from `first` to the end, still writable, so `.fill`
    // writes into the original.
    fn fill_signal(&mut self, signal: usize, from: i32, value: f32) {
        let first = usize::try_from(from + 1).unwrap_or(0).min(SLOT);
        self.signals[signal][first..].fill(value);
        self.current[signal] = value;
    }
}

impl Track {
    // TS: static create(): Track, with no plan: silent until one loads.
    pub(super) fn new() -> Self {
        Track {
            plan: None,
            params: Vec::new(),
            constants: Vec::new(),
            pre: SectionState::empty(),
            post: SectionState::empty(),
            voices: Vec::new(),
            voice_sum: [SILENT_SLOT; CHANNELS],
            inputs: [SILENT_SLOT; MAX_INPUTS],
            output: [[0.0; BLOCK]; CHANNELS],
        }
    }

    /// Replace the track's graph. Sounding voices are cut for now; crossfading them into the new plan
    /// comes with the engine client (INST-36.5).
    // `plan: Plan` (no `&`) takes ownership: the caller hands the plan over, and the track keeps it
    // in `self.plan` at the end. Assigning over the old sections and voices frees them.
    pub(super) fn load(&mut self, plan: Plan, sample_rate: i32) {
        if self.params.len() != plan.param_count {
            self.params = vec![ParamSource::default(); plan.param_count];
        }
        // TS: this.constants = plan.constants.map((value) => new Float32Array(SLOT).fill(value))
        self.constants = plan.constants.iter().map(|&value| [value; SLOT]).collect();
        self.pre = SectionState::new(&plan.pre, sample_rate);
        self.post = SectionState::new(&plan.post, sample_rate);
        self.voices = (0..plan.voice_count).map(|_| Voice::new(&plan.voice, sample_rate)).collect();
        self.plan = Some(plan);
    }

    /// Render one block: pre, then every sounding voice, then post, into `output`.
    pub(super) fn process(&mut self) {
        // TS: each param's buffer ramps from current to target across the block.
        // `let (a, b) = (x, y)` sets two variables at once, like TS array destructuring.
        // `*sample = ...` writes through the writable loan `iter_mut` handed out.
        self.params.iter_mut().for_each(|param| {
            let (current, step) = (param.current, param.target - param.current);
            param.buffer.iter_mut().enumerate().for_each(|(index, sample)| {
                *sample = current + step * index as f32 / BLOCK as f32;
            });
            param.current = param.target;
        });
        self.output.iter_mut().for_each(|channel| channel.fill(0.0));
        self.voice_sum.iter_mut().for_each(|channel| channel.fill(0.0));
        // TS: const plan = this.plan; if (!plan) return;
        let Some(plan) = &self.plan else { return };

        // Rust lets one function hold loans of different fields of `self` at once (`self.inputs` read,
        // `self.pre` written), since they can't overlap. These loans all end with the function.
        let context = Context {
            shared: &[],
            shared_base: &[],
            signals: &NO_SIGNALS,
            voice_sum: &NO_VOICE_SUM,
            inputs: &self.inputs,
            params: &self.params,
            constants: &self.constants,
        };
        Render { section: &plan.pre, units: &mut self.pre.units, buffers: &mut self.pre.buffers, context }.run();

        // TS: { ...context, shared: this.pre.buffers, sharedBase: plan.pre.base }. `..context` is the spread.
        let shared = Context { shared: &self.pre.buffers, shared_base: &plan.pre.base, ..context };
        // TS: for (const voice of this.voices.filter((voice) => voice.active))
        for voice in self.voices.iter_mut().filter(|voice| voice.active) {
            let voice_context = Context { signals: &voice.signals, ..shared };
            Render { section: &plan.voice, units: &mut voice.state.units, buffers: &mut voice.state.buffers, context: voice_context }.run();
            // Velocity scales the voice on the way into the sum, as the Web Audio engine's `amp` does.
            let sources = Sources::whole(&plan.voice.base, &voice.state.buffers, voice_context);
            let velocity = &voice.signals[SIGNAL_VELOCITY][1..];
            // `0.0f32` is a literal typed as f32.
            let mut peak = 0.0f32;
            // TS: for each channel: the source for it (a mono output plays in both), summed in.
            // `.or(x)` on an Option: itself if Some, else x. `let Some(&source) = ... else { return }`
            // skips a channel with no source (a voice with no output).
            self.voice_sum.iter_mut().enumerate().for_each(|(channel, sum)| {
                let Some(&source) = plan.voice_out.get(channel).or(plan.voice_out.first()) else { return };
                let samples = sources.samples(source, 0, BLOCK);
                sum[1..].iter_mut().zip(samples).zip(velocity).for_each(|((mixed, &sample), &gain)| {
                    *mixed += sample * gain;
                    peak = peak.max(sample.abs());
                });
            });
            voice.state.carry();
            // TS: each signal refilled with its current value for the next block.
            voice.signals.iter_mut().zip(voice.current).for_each(|(signal, value)| signal.fill(value));
            if voice.released && peak < SILENCE {
                voice.active = false;
            }
        }

        let post_context = Context { voice_sum: &self.voice_sum, ..shared };
        Render { section: &plan.post, units: &mut self.post.units, buffers: &mut self.post.buffers, context: post_context }.run();
        let sources = Sources::whole(&plan.post.base, &self.post.buffers, post_context);
        // TS: output.forEach((channel, i) => { const source = trackOut[i] ?? trackOut[0]; if (source) channel.set(sources.samples(source, 0, BLOCK)) })
        self.output.iter_mut().enumerate().for_each(|(channel, output)| {
            if let Some(&source) = plan.track_out.get(channel).or(plan.track_out.first()) {
                output.copy_from_slice(sources.samples(source, 0, BLOCK));
            }
        });
        self.pre.carry();
        self.post.carry();
    }

    /// Start a note in a voice slot, `offset` samples into the coming block. A busy slot is reset
    /// (stolen).
    // TS: const voice = this.voices[slot]; if (!voice) return; ...
    // `let Some(voice) = ... else { return };` is that, in one line. `get_mut` is a safe index giving
    // a writable loan, or None past the end.
    pub(super) fn note_on(&mut self, slot: usize, offset: i32, frequency: f32, velocity: f32) {
        let Some(voice) = self.voices.get_mut(slot) else { return };
        if !voice.active {
            (0..VOICE_SIGNALS).for_each(|signal| voice.fill_signal(signal, -1, 0.0));
        }
        voice.state.clear();
        voice.active = true;
        voice.released = false;
        voice.fill_signal(SIGNAL_FREQ, offset, frequency);
        voice.fill_signal(SIGNAL_VELOCITY, offset, velocity);
        voice.fill_signal(SIGNAL_GATE, offset, 1.0);
    }

    // TS: const voice = this.voices[slot]; if (!voice?.active) return; voice.released = true; ...
    pub(super) fn note_off(&mut self, slot: usize, offset: i32) {
        let Some(voice) = self.voices.get_mut(slot).filter(|voice| voice.active) else { return };
        voice.released = true;
        voice.fill_signal(SIGNAL_GATE, offset, 0.0);
    }

    /// Set a param's value; it ramps there over the next block.
    // TS: const param = this.params[source]; if (param) param.target = value;
    // `get_mut` is a safe index giving a writable loan, or None past the end.
    pub(super) fn set_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.params.get_mut(source) {
            param.target = value;
        }
    }

    /// Jump a param to a value with no ramp (initial values).
    // `*param = ...` replaces the whole value the loan points at.
    pub(super) fn init_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.params.get_mut(source) {
            *param = ParamSource { current: value, target: value, buffer: [value; SLOT] };
        }
    }

    // TS: return this.voices[slot]?.active ?? false
    pub(super) fn voice_active(&self, slot: usize) -> bool {
        self.voices.get(slot).is_some_and(|voice| voice.active)
    }

    // TS: return this.output[channel]
    pub(super) fn output(&self, channel: usize) -> Option<&[f32; BLOCK]> {
        self.output.get(channel)
    }

    // TS: return this.inputs[channel]?.subarray(1)
    // `.map(f)` on an Option: f(value) if there is one. Slot 0 is the engine's, so JS gets 1..=128.
    pub(super) fn input_mut(&mut self, channel: usize) -> Option<&mut [f32]> {
        self.inputs.get_mut(channel).map(|slot| &mut slot[1..])
    }
}
