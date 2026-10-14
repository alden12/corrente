//! One track of the bank: its plan, params and voices, and the block it renders: the pre section,
//! every sounding voice summed, then the post section, into a stereo output.
//!
//! Nothing changes with a click (INST-36.5):
//! - **A new plan crossfades in.** The graph it replaces keeps rendering for one more block, fading
//!   out while the new one fades in. JS restarts the held notes in the new plan.
//! - **A stolen voice fades out** over CUT samples rather than stopping dead. Each graph has
//!   SPARE_VOICES more slots than its plan asks for, so the new note starts in a free one on time
//!   while the old one fades.
//! - **Or a new plan carries on** (INST-36.7): straight after a load, JS can say which of the new
//!   plan's nodes are the old plan's (`carry`), and those take over their state, so a delay's tail
//!   rings on and held notes keep playing. There's no crossfade then, since the old graph has given
//!   its state away: JS makes the change smooth itself (an effect added or removed is bypassed
//!   around the load).

use super::render::{Render, Unit};
use super::sampler::Sample;
use super::sources::{Context, Sources};
use super::{BLOCK, NO_SIGNALS, NO_VOICE_SUM, SILENCE, SILENT_SLOT, SLOT, Slot};
use crate::plan::{CHANNELS, HOST_SIGNALS, MAX_INPUTS, Node, Plan, SIGNAL_FREQ, SIGNAL_GATE, SIGNAL_NOTE, SIGNAL_SAMPLE, SIGNAL_SEED, SIGNAL_VELOCITY, Section, VOICE_SIGNALS};

/// One section's state, in a track or in one voice: a unit per node and a buffer per node output.
struct SectionState {
    units: Vec<Unit>,
    buffers: Vec<Slot>,
}

struct Voice {
    state: SectionState,
    signals: [Slot; VOICE_SIGNALS],
    current: [f32; VOICE_SIGNALS],
    active: bool,
    released: bool,
    /// Being cut: fading out from sample `cut_from` of this block, at `cut_gain` when it starts.
    cutting: bool,
    cut_from: usize,
    cut_gain: f32,
}

/// Slots a graph has beyond its plan's voices, for notes that start while stolen ones fade.
pub(super) const SPARE_VOICES: usize = 4;
/// How long a cut voice takes to fade out, in samples.
const CUT: usize = BLOCK;

/// A param's smoothed buffer: each change ramps from where it was (`from`) to `target` over `ramp`
/// samples, a block unless JS says longer (a bypass fades over 20 ms, so it doesn't thump).
// `Clone` lets `vec![ParamSource::default(); n]` copy it n times; it isn't `Copy` (copied
// implicitly) because a 129-float array is too big to copy without saying so.
#[derive(Clone)]
pub(super) struct ParamSource {
    from: f32,
    target: f32,
    /// How far into the ramp it is, in samples, up to `ramp`.
    elapsed: usize,
    ramp: usize,
    pub(super) buffer: Slot,
}

// `Default` is a standard trait for "a sensible starting value". `Self` is the type being implemented.
impl Default for ParamSource {
    fn default() -> Self {
        Self { from: 0.0, target: 0.0, elapsed: BLOCK, ramp: BLOCK, buffer: SILENT_SLOT }
    }
}

impl ParamSource {
    /// Its value `ahead` samples on from where the ramp is.
    // TS: return this.from + (this.target - this.from) * Math.min(this.elapsed + ahead, this.ramp) / this.ramp
    fn value(&self, ahead: usize) -> f32 {
        let done = (self.elapsed + ahead).min(self.ramp);
        self.from + (self.target - self.from) * done as f32 / self.ramp as f32
    }

    /// Fill the block's buffer along the ramp (slot 0 is where it was), and move along it.
    // TS: this.buffer.forEach((_, index) => (this.buffer[index] = this.value(index))); this.elapsed = Math.min(this.elapsed + BLOCK, this.ramp);
    fn advance(&mut self) {
        // The buffer is taken out first, so `self.value` can read the rest of `self` while it's filled.
        let mut buffer = self.buffer;
        buffer.iter_mut().enumerate().for_each(|(index, sample)| *sample = self.value(index));
        self.buffer = buffer;
        self.elapsed = (self.elapsed + BLOCK).min(self.ramp);
    }
}

/// A plan and everything it runs on. A track has one, and for the block after a load, the one it
/// replaced, fading out.
struct Graph {
    plan: Plan,
    params: Vec<ParamSource>,
    constants: Vec<Slot>,
    pre: SectionState,
    post: SectionState,
    voices: Vec<Voice>,
}

/// One block of a track's stereo output.
type Output = [[f32; BLOCK]; CHANNELS];

/// One track of the bank: its graph, and what every graph it plays shares.
// `inputs` and `output` sit inside the track, so they stay at one address while the bank exists:
// JS is handed pointers to them once.
pub(super) struct Track {
    graph: Option<Graph>,
    /// The graph the last load replaced. It fades out over the block after the load, then stays,
    /// silent, until the next load drops it: freed there rather than while rendering.
    outgoing: Option<Graph>,
    fading: bool,
    voice_sum: [Slot; CHANNELS],
    inputs: [Slot; MAX_INPUTS],
    output: Output,
    /// The outgoing graph's block, while it fades.
    faded: Output,
    /// Where the seeds come from: a small random number generator, the same sequence every time the
    /// bank starts, so an offline render comes out the same twice.
    seeds: u32,
    /// The loudest sample in each output channel last block, for level meters.
    peaks: [f32; CHANNELS],
    /// Whether last block was silent: no voice sounding and nothing above SILENCE out. A silent
    /// track can be skipped (DAW-57) until something changes.
    silent: bool,
}

impl SectionState {
    /// A unit and buffers for every node; `constants` are the plan's literals (a delay's size).
    fn new(section: &Section, sample_rate: i32, constants: &[f32]) -> Self {
        SectionState {
            units: section.nodes.iter().map(|node| Unit::new(node, sample_rate, constants)).collect(),
            // TS: Array.from({ length: section.bufferCount }, () => new Float32Array(SLOT))
            buffers: vec![SILENT_SLOT; section.buffer_count],
        }
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
    fn cut_at(&self, index: usize) -> f32 {
        if !self.cutting || index < self.cut_from {
            return self.cut_gain;
        }
        (self.cut_gain - (index - self.cut_from + 1) as f32 / CUT as f32).max(0.0)
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

impl Graph {
    fn new(plan: Plan, sample_rate: i32) -> Self {
        Graph {
            params: vec![ParamSource::default(); plan.param_count],
            // TS: plan.constants.map((value) => new Float32Array(SLOT).fill(value))
            constants: plan.constants.iter().map(|&value| [value; SLOT]).collect(),
            pre: SectionState::new(&plan.pre, sample_rate, &plan.constants),
            post: SectionState::new(&plan.post, sample_rate, &plan.constants),
            voices: (0..plan.voice_count + SPARE_VOICES).map(|_| Voice::new(&plan.voice, sample_rate, &plan.constants)).collect(),
            plan,
        }
    }

    /// Render one block into `output`: pre, then every sounding voice into `voice_sum`, then post.
    // Taking the track's `inputs` and `voice_sum` as arguments lets two graphs share them in turn.
    fn render(&mut self, inputs: &[Slot; MAX_INPUTS], host: &[Slot; HOST_SIGNALS], samples: &[Option<Sample>], voice_sum: &mut [Slot; CHANNELS], output: &mut Output) {
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
    fn sounding(&self) -> bool {
        self.voices.iter().any(|voice| voice.active)
    }
}

impl Track {
    // With no plan: silent until one loads.
    pub(super) fn new() -> Self {
        Track {
            graph: None,
            outgoing: None,
            fading: false,
            voice_sum: [SILENT_SLOT; CHANNELS],
            inputs: [SILENT_SLOT; MAX_INPUTS],
            output: [[0.0; BLOCK]; CHANNELS],
            faded: [[0.0; BLOCK]; CHANNELS],
            seeds: 0x9E37_79B9,
            peaks: [0.0; CHANNELS],
            silent: true,
        }
    }

    /// Replace the track's graph. The one it replaces fades out over the next block.
    // `plan: Plan` (no `&`) takes ownership: the caller hands the plan over, and the new graph keeps
    // it. `.take()` moves the graph out of `self.graph`, leaving None; assigning over `outgoing` frees
    // the graph that was fading before, here rather than while rendering.
    // TS: this.outgoing = this.graph; this.fading = this.graph !== undefined; this.graph = new Graph(plan, sampleRate);
    pub(super) fn load(&mut self, plan: Plan, sample_rate: i32) {
        self.outgoing = self.graph.take();
        self.fading = self.outgoing.is_some();
        self.graph = Some(Graph::new(plan, sample_rate));
    }

    /// Hand the outgoing graph's state to the one just loaded. `words` are whether the voices carry
    /// (1 or 0), then for the pre and the post section a count and, for each of the new plan's nodes,
    /// the old node it takes over or -1. The number of nodes carried, or None (nothing changed) if
    /// there's no outgoing graph or the words don't fit both plans: a count that isn't the section's,
    /// an old node used twice, or a pair of nodes that aren't the same kind. Voices carry only
    /// between voice sections of the same nodes, since a voice moves over whole.
    // TS:
    //   const [voices, ...rest] = words; const [pre, afterPre] = sectionMap(rest); const [post, end] = sectionMap(afterPre);
    //   if (!this.graph || !this.outgoing || end.length || !fits(...)) return undefined;
    //   let carried = takeOver(pre section) + takeOver(post section);
    //   if (voices === 1) { swap the two graphs' voices; carried += voice nodes }
    //   if (carried > 0 || voices === 1) this.fading = false;
    //   return carried;
    pub(super) fn carry(&mut self, words: &[i32]) -> Option<usize> {
        // `split_first` gives the first item and the rest, or None if empty.
        let (&voices, rest) = words.split_first()?;
        let (pre, rest) = section_map(rest)?;
        let (post, rest) = section_map(rest)?;
        let (Some(graph), Some(old)) = (self.graph.as_mut(), self.outgoing.as_mut()) else { return None };
        // TS: const voicesFit = () => same lengths && every voice node the same kind as the old one at its place
        let voices_fit = || {
            graph.voices.len() == old.voices.len()
                && graph.plan.voice.buffer_count == old.plan.voice.buffer_count
                && graph.plan.voice.nodes.len() == old.plan.voice.nodes.len()
                && graph.plan.voice.nodes.iter().zip(&old.plan.voice.nodes).all(|(node, other)| same_node(node, other))
        };
        // Check it all before changing anything.
        let fits = rest.is_empty()
            && (voices == 0 || (voices == 1 && voices_fit()))
            && map_fits(&graph.plan.pre, &graph.pre, &old.plan.pre, &old.pre, pre)
            && map_fits(&graph.plan.post, &graph.post, &old.plan.post, &old.post, post);
        if !fits {
            return None;
        }
        let mut carried = take_over(&graph.plan.pre, &mut graph.pre, &old.plan.pre, &mut old.pre, pre)
            + take_over(&graph.plan.post, &mut graph.post, &old.plan.post, &mut old.post, post);
        if voices == 1 {
            // TS: [graph.voices, old.voices] = [old.voices, graph.voices]
            std::mem::swap(&mut graph.voices, &mut old.voices);
            carried += graph.plan.voice.nodes.len();
        }
        // The old graph has given away what it would fade out with.
        if carried > 0 || voices == 1 {
            self.fading = false;
        }
        Some(carried)
    }

    /// Render one block into `output`, crossfading from the outgoing graph in the block after a load.
    pub(super) fn process(&mut self, host: &[Slot; HOST_SIGNALS], samples: &[Option<Sample>]) {
        // TS: if (this.graph) this.graph.render(this.inputs, host, samples, this.voiceSum, this.output); else this.output.forEach((channel) => channel.fill(0));
        match &mut self.graph {
            Some(graph) => graph.render(&self.inputs, host, samples, &mut self.voice_sum, &mut self.output),
            None => self.output.iter_mut().for_each(|channel| channel.fill(0.0)),
        }
        // TS:
        //   if (this.fading && this.outgoing) {
        //     this.outgoing.render(this.inputs, host, this.voiceSum, this.faded);
        //     each sample: output = output * fadeIn + faded * (1 - fadeIn), fadeIn rising to 1 over the block
        //   }
        //   this.fading = false;
        if let (true, Some(outgoing)) = (self.fading, &mut self.outgoing) {
            outgoing.render(&self.inputs, host, samples, &mut self.voice_sum, &mut self.faded);
            self.output.iter_mut().zip(&self.faded).for_each(|(channel, faded)| {
                channel.iter_mut().zip(faded).enumerate().for_each(|(index, (sample, &old))| {
                    let fade_in = (index + 1) as f32 / BLOCK as f32;
                    *sample = *sample * fade_in + old * (1.0 - fade_in);
                });
            });
        }
        self.fading = false;
        self.measure();
    }

    /// Note the block's peaks, and whether it was silent.
    // TS:
    //   this.peaks = this.output.map((channel) => Math.max(...channel.map(Math.abs)));
    //   this.silent = !this.graph?.sounding() && this.peaks.every((peak) => peak < SILENCE);
    // `fold(0.0, f)` is `reduce(f, 0)`; `f32::max` names the method as a two-argument function.
    // `std::array::from_fn` builds the fixed-size array from each channel's index.
    fn measure(&mut self) {
        self.peaks = std::array::from_fn(|channel| self.output[channel].iter().map(|sample| sample.abs()).fold(0.0, f32::max));
        let sounding = self.graph.as_ref().is_some_and(Graph::sounding);
        self.silent = !sounding && self.peaks.iter().all(|&peak| peak < SILENCE);
    }

    /// The current graph's voice in `slot`, if there is one.
    // TS: return this.graph?.voices[slot]
    // `.as_mut()` lends the graph out of the Option writably; `?` gives back None if there's none.
    fn voice_mut(&mut self, slot: usize) -> Option<&mut Voice> {
        self.graph.as_mut()?.voices.get_mut(slot)
    }

    /// Start a note in a voice slot, `offset` samples into the coming block. A busy slot is reset
    /// at once: JS cuts a voice first and starts the note in another slot, so this only happens when
    /// every slot is busy.
    // TS: const voice = this.voiceMut(slot); if (!voice) return; ...
    // `let Some(voice) = ... else { return };` is that, in one line.
    pub(super) fn note_on(&mut self, slot: usize, offset: i32, frequency: f32, velocity: f32, note: f32) {
        let seed = self.next_seed();
        let Some(voice) = self.voice_mut(slot) else { return };
        if !voice.active {
            (0..VOICE_SIGNALS).for_each(|signal| voice.fill_signal(signal, -1, 0.0));
        }
        voice.state.clear();
        voice.active = true;
        voice.released = false;
        voice.cutting = false;
        voice.cut_gain = 1.0;
        voice.fill_signal(SIGNAL_FREQ, offset, frequency);
        voice.fill_signal(SIGNAL_VELOCITY, offset, velocity);
        voice.fill_signal(SIGNAL_NOTE, offset, note);
        voice.fill_signal(SIGNAL_SEED, offset, seed);
        voice.fill_signal(SIGNAL_GATE, offset, 1.0);
    }

    /// The next seed, from 0 to 1 (xorshift: three shifts and exclusive-ors, fast and plenty random
    /// for drift and variation).
    // TS:
    //   let x = this.seeds; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seeds = x >>> 0;
    //   return this.seeds / 2 ** 32;
    // Rust's `<<` on a u32 drops the bits shifted out, as JS's does on a 32-bit int; `>>` on an
    // unsigned number is JS's `>>>`.
    fn next_seed(&mut self) -> f32 {
        let mut x = self.seeds;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seeds = x;
        (x as f64 / 4_294_967_296.0) as f32
    }

    /// Set one of a sounding voice's zone signals for the whole coming block: how JS gives a note the
    /// sample zone it picked, right after its note on. The whole block, not from the note's sample on,
    /// because controls read their inputs at the start of every CONTROL samples: a sampler must see
    /// its zone at the read before the gate rises. Nothing sounds before the gate, so nothing is lost.
    // TS: const voice = this.voiceMut(slot); if (voice?.active && signal >= SIGNAL_SAMPLE && signal < VOICE_SIGNALS) voice.fillSignal(signal, -1, value);
    pub(super) fn set_voice_signal(&mut self, slot: usize, signal: usize, value: f32) {
        let Some(voice) = self.voice_mut(slot).filter(|voice| voice.active) else { return };
        if (SIGNAL_SAMPLE..VOICE_SIGNALS).contains(&signal) {
            voice.fill_signal(signal, -1, value);
        }
    }

    // TS: const voice = this.voiceMut(slot); if (!voice?.active) return; voice.released = true; ...
    pub(super) fn note_off(&mut self, slot: usize, offset: i32) {
        let Some(voice) = self.voice_mut(slot).filter(|voice| voice.active) else { return };
        voice.released = true;
        voice.fill_signal(SIGNAL_GATE, offset, 0.0);
    }

    /// Fade a voice out over CUT samples from `offset` into the coming block, then free its slot: how
    /// a stolen voice goes without a click.
    // TS: const voice = this.voiceMut(slot); if (!voice?.active || voice.cutting) return; voice.cutting = true; voice.cutFrom = clamp(offset, 0, BLOCK - 1);
    pub(super) fn cut(&mut self, slot: usize, offset: i32) {
        let Some(voice) = self.voice_mut(slot).filter(|voice| voice.active && !voice.cutting) else { return };
        voice.cutting = true;
        voice.cut_from = usize::try_from(offset).unwrap_or(0).min(BLOCK - 1);
    }

    /// Set a param's value; it ramps there from where it is, over its ramp.
    // TS: const param = this.graph?.params[source]; if (param) { param.from = param.value(0); param.target = value; param.elapsed = 0 }
    // `get_mut` is a safe index giving a writable loan, or None past the end.
    pub(super) fn set_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.graph.as_mut().and_then(|graph| graph.params.get_mut(source)) {
            param.from = param.value(0);
            param.target = value;
            param.elapsed = 0;
        }
    }

    /// Jump a param to a value with no ramp (initial values). Its ramp length stays.
    // TS: Object.assign(param, { from: value, target: value, elapsed: param.ramp, buffer: new Float32Array(SLOT).fill(value) })
    // `..*param` fills the fields not named from the param as it was (only `ramp` here).
    pub(super) fn init_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.graph.as_mut().and_then(|graph| graph.params.get_mut(source)) {
            *param = ParamSource { from: value, target: value, elapsed: param.ramp, buffer: [value; SLOT], ..*param };
        }
    }

    /// How many samples a param's changes ramp over from now on: at least one. A ramp under way stops
    /// where it is (JS sets this straight after a load, before anything moves).
    // TS: const param = this.graph?.params[source]; if (param) { const value = param.value(0); Object.assign(param, { from: value, target: value, ramp: Math.max(samples, 1), elapsed: Math.max(samples, 1) }) }
    pub(super) fn set_ramp(&mut self, source: usize, samples: usize) {
        if let Some(param) = self.graph.as_mut().and_then(|graph| graph.params.get_mut(source)) {
            let value = param.value(0);
            *param = ParamSource { from: value, target: value, elapsed: samples.max(1), ramp: samples.max(1), ..*param };
        }
    }

    // TS: return this.graph?.voices[slot]?.active ?? false
    pub(super) fn voice_active(&self, slot: usize) -> bool {
        self.graph.as_ref().and_then(|graph| graph.voices.get(slot)).is_some_and(|voice| voice.active)
    }

    /// How many voice slots the current graph has: its plan's voices and the spares.
    // TS: return this.graph?.voices.length ?? 0
    pub(super) fn voice_slots(&self) -> usize {
        self.graph.as_ref().map_or(0, |graph| graph.voices.len())
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

    // TS: return this.peaks[channel]
    pub(super) fn peak(&self, channel: usize) -> Option<f32> {
        self.peaks.get(channel).copied()
    }

    pub(super) fn silent(&self) -> bool {
        self.silent
    }

    // TS: return this.graph?.plan.latency ?? 0
    // `.as_ref()` lends the graph out of the Option rather than moving it; `.map_or(default, f)`.
    pub(super) fn latency(&self) -> usize {
        self.graph.as_ref().map_or(0, |graph| graph.plan.latency)
    }

    /// What a node's meter `index` shows: in the pre (0) or post (2) section, that node's; in the voice
    /// section (1), the highest across the sounding voices, or 0 with none sounding. None if there is
    /// no such section, node or meter.
    // TS:
    //   const graph = this.graph; if (!graph) return undefined;
    //   switch (section) {
    //     case 0: return graph.pre.units[node]?.meter(index);
    //     case 1: { if (graph.voices[0]?.state.units[node]?.meter(index) === undefined) return undefined;
    //               return Math.max(0, ...activeVoices.map((voice) => voice.state.units[node].meter(index))) }
    //     case 2: return graph.post.units[node]?.meter(index);
    //   }
    // `.first()?` returns None from the function if there are no voices. `filter_map(f)` keeps each
    // f(voice) that is Some.
    pub(super) fn meter(&self, section: usize, node: usize, index: usize) -> Option<f32> {
        let graph = self.graph.as_ref()?;
        let in_section = |state: &SectionState| -> Option<f32> { state.units.get(node)?.meter(index) };
        match section {
            0 => in_section(&graph.pre),
            1 => {
                in_section(&graph.voices.first()?.state)?;
                let sounding = graph.voices.iter().filter(|voice| voice.active).filter_map(|voice| in_section(&voice.state));
                Some(sounding.fold(0.0, f32::max))
            }
            2 => in_section(&graph.post),
            _ => None,
        }
    }
}

/// One section's part of carry's words: its count, then that many old node indices; and the rest.
// TS: const count = words[0]; return count >= 0 && words.length > count ? [words.slice(1, count + 1), words.slice(count + 1)] : undefined
// `split_at(n)` gives the first n and the rest, as two views of the same words.
fn section_map(words: &[i32]) -> Option<(&[i32], &[i32])> {
    let (&count, rest) = words.split_first()?;
    let count = usize::try_from(count).ok()?;
    (rest.len() >= count).then(|| rest.split_at(count))
}

/// Whether two plans' nodes are the same kind of thing, so one can take over the other's state.
// TS: return node.kind === other.kind && node.outputs === other.outputs
fn same_node(node: &Node, other: &Node) -> bool {
    node.kind == other.kind && node.outputs == other.outputs
}

/// Whether a section's map fits: one entry per new node, each -1 or an old node of the same kind
/// (and, for a delay, the same ring length), no old node taken twice.
// TS:
//   const taken = new Set<number>();
//   return map.length === section.nodes.length && map.every((from, index) => {
//     if (from < 0) return true;
//     const other = old.nodes[from];
//     if (!other || taken.has(from) || !sameNode(section.nodes[index], other) || !state.units[index].fits(oldState.units[from])) return false;
//     taken.add(from); return true;
//   });
// It allocates (the `taken` list), which is fine here: carry runs with a load, never while rendering.
fn map_fits(section: &Section, state: &SectionState, old: &Section, old_state: &SectionState, map: &[i32]) -> bool {
    let mut taken = vec![false; old.nodes.len()];
    map.len() == section.nodes.len()
        && map.iter().enumerate().all(|(index, &from)| {
            let Ok(from) = usize::try_from(from) else { return true };
            let fits = old.nodes.get(from).is_some_and(|other| same_node(&section.nodes[index], other))
                && !taken[from]
                && state.units[index].fits(&old_state.units[from]);
            if fits {
                taken[from] = true;
            }
            fits
        })
}

/// Move each mapped node's unit, and its output buffers (its last sample, for feedback), from the old
/// section to the new. The old section gets the new one's fresh units in their place. Returns how
/// many moved.
// TS:
//   return map.filter((from, index) => {
//     if (from < 0) return false;
//     [state.units[index], oldState.units[from]] = [oldState.units[from], state.units[index]];
//     for (let port = 0; port < section.nodes[index].outputs; port++) state.buffers[section.base[index] + port].set(oldState.buffers[old.base[from] + port]);
//     return true;
//   }).length;
// `std::mem::swap` trades two values in place: the only way to move a unit out of a list without
// leaving a hole.
fn take_over(section: &Section, state: &mut SectionState, old: &Section, old_state: &mut SectionState, map: &[i32]) -> usize {
    map.iter()
        .enumerate()
        .filter(|&(index, &from)| {
            let Ok(from) = usize::try_from(from) else { return false };
            std::mem::swap(&mut state.units[index], &mut old_state.units[from]);
            (0..section.nodes[index].outputs).for_each(|port| {
                state.buffers[section.base[index] + port] = old_state.buffers[old.base[from] + port];
            });
            true
        })
        .count()
}
