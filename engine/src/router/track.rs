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

use super::carry::{map_fits, section_map, same_node, take_over};
use super::graph::{Graph, Output, SectionState, Voice};
use super::params::ParamSource;
use super::sampler::Sample;
use super::{BLOCK, SILENCE, SILENT_SLOT, SLOT, Slot};
use crate::plan::{CHANNELS, HOST_SIGNALS, MAX_INPUTS, Plan, SIGNAL_FREQ, SIGNAL_GATE, SIGNAL_NOTE, SIGNAL_SAMPLE, SIGNAL_SEED, SIGNAL_VELOCITY, VOICE_SIGNALS};

/// One track of the bank: its graph, and what every graph it plays shares.
// `inputs` and `output` sit inside the track, so they stay at one address while the bank exists:
// JS is handed pointers to them once.
pub struct Track {
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

    /// Replace the track's graph. The one it replaces fades out over the next block. A second load
    /// before that block replaces a graph that never played, so the one still sounding (outgoing)
    /// stays the one that fades.
    // `plan: Plan` (no `&`) takes ownership: the caller hands the plan over, and the new graph keeps
    // it. `.take()` moves the graph out of `self.graph`, leaving None; assigning over `outgoing` frees
    // the graph that was fading before, here rather than while rendering.
    // TS: if (!this.fading) { this.outgoing = this.graph; this.fading = this.graph !== undefined; } this.graph = new Graph(plan, sampleRate);
    pub(super) fn load(&mut self, plan: Plan, sample_rate: i32) {
        if !self.fading {
            self.outgoing = self.graph.take();
            self.fading = self.outgoing.is_some();
        }
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
    pub fn carry(&mut self, words: &[i32]) -> Option<usize> {
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
    pub fn note_on(&mut self, slot: usize, offset: i32, frequency: f32, velocity: f32, note: f32) {
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
    pub fn set_voice_signal(&mut self, slot: usize, signal: usize, value: f32) {
        let Some(voice) = self.voice_mut(slot).filter(|voice| voice.active) else { return };
        if (SIGNAL_SAMPLE..VOICE_SIGNALS).contains(&signal) {
            voice.fill_signal(signal, -1, value);
        }
    }

    // TS: const voice = this.voiceMut(slot); if (!voice?.active) return; voice.released = true; ...
    pub fn note_off(&mut self, slot: usize, offset: i32) {
        let Some(voice) = self.voice_mut(slot).filter(|voice| voice.active) else { return };
        voice.released = true;
        voice.fill_signal(SIGNAL_GATE, offset, 0.0);
    }

    /// Fade a voice out over CUT samples from `offset` into the coming block, then free its slot: how
    /// a stolen voice goes without a click.
    // TS: const voice = this.voiceMut(slot); if (!voice?.active || voice.cutting) return; voice.cutting = true; voice.cutFrom = clamp(offset, 0, BLOCK - 1);
    pub fn cut(&mut self, slot: usize, offset: i32) {
        let Some(voice) = self.voice_mut(slot).filter(|voice| voice.active && !voice.cutting) else { return };
        voice.cutting = true;
        voice.cut_from = usize::try_from(offset).unwrap_or(0).min(BLOCK - 1);
    }

    /// Set a param's value; it ramps there from where it is, over its ramp.
    // TS: const param = this.graph?.params[source]; if (param) { param.from = param.value(0); param.target = value; param.elapsed = 0 }
    // `get_mut` is a safe index giving a writable loan, or None past the end.
    pub fn set_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.graph.as_mut().and_then(|graph| graph.params.get_mut(source)) {
            param.from = param.value(0);
            param.target = value;
            param.elapsed = 0;
        }
    }

    /// Jump a param to a value with no ramp (initial values). Its ramp length stays.
    // TS: Object.assign(param, { from: value, target: value, elapsed: param.ramp, buffer: new Float32Array(SLOT).fill(value) })
    // `..*param` fills the fields not named from the param as it was (only `ramp` here).
    pub fn init_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.graph.as_mut().and_then(|graph| graph.params.get_mut(source)) {
            *param = ParamSource { from: value, target: value, elapsed: param.ramp, buffer: [value; SLOT], ..*param };
        }
    }

    /// How many samples a param's changes ramp over from now on: at least one. A ramp under way stops
    /// where it is (JS sets this straight after a load, before anything moves).
    // TS: const param = this.graph?.params[source]; if (param) { const value = param.value(0); Object.assign(param, { from: value, target: value, ramp: Math.max(samples, 1), elapsed: Math.max(samples, 1) }) }
    pub fn set_ramp(&mut self, source: usize, samples: usize) {
        if let Some(param) = self.graph.as_mut().and_then(|graph| graph.params.get_mut(source)) {
            let value = param.value(0);
            *param = ParamSource { from: value, target: value, elapsed: samples.max(1), ramp: samples.max(1), ..*param };
        }
    }

    // TS: return this.graph?.voices[slot]?.active ?? false
    pub fn voice_active(&self, slot: usize) -> bool {
        self.graph.as_ref().and_then(|graph| graph.voices.get(slot)).is_some_and(|voice| voice.active)
    }

    /// How many voice slots the current graph has: its plan's voices and the spares.
    // TS: return this.graph?.voices.length ?? 0
    pub fn voice_slots(&self) -> usize {
        self.graph.as_ref().map_or(0, |graph| graph.voices.len())
    }

    // TS: return this.output[channel]
    pub fn output(&self, channel: usize) -> Option<&[f32; BLOCK]> {
        self.output.get(channel)
    }

    // TS: return this.inputs[channel]?.subarray(1)
    // `.map(f)` on an Option: f(value) if there is one. Slot 0 is the engine's, so JS gets 1..=128.
    pub fn input_mut(&mut self, channel: usize) -> Option<&mut [f32]> {
        self.inputs.get_mut(channel).map(|slot| &mut slot[1..])
    }

    // TS: return this.peaks[channel]
    pub fn peak(&self, channel: usize) -> Option<f32> {
        self.peaks.get(channel).copied()
    }

    pub fn silent(&self) -> bool {
        self.silent
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
    pub fn meter(&self, section: usize, node: usize, index: usize) -> Option<f32> {
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
