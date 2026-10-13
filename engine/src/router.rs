//! The router: runs a bank of tracks, each following its own plan, one 128-sample block at a time.
//!
//! - **A track** runs its plan's pre section once, the voice section for every sounding voice
//!   (summing them, scaled by velocity, into a stereo voice sum), then the post section, and writes
//!   a stereo output. Tracks are independent: each has its own params, voices and audio inputs.
//! - **Audio inputs** to a block are buffers handed to its compute. **Control inputs** are Faust
//!   sliders, set from their source every CONTROL samples, so a filter recomputes its coefficients
//!   4 times a block rather than 128.
//! - **A step** is one node over the block, or a feedback loop. A loop whose every cycle passes
//!   through a delay runs in chunks as long as the shortest delay (delays read first, write last).
//!   Any other loop runs one sample at a time, its feedback edges reading the sample before.
//! - **The delay is native**, not Faust: it has to split into a read and a write around the rest of
//!   the loop.
//!
//! Every buffer is a `Slot` of 129 floats: slot 0 holds the last sample of the previous block,
//! 1..=128 the current one, so a feedback edge reads "the sample before" by offset, even at sample 0.
//! A node with several outputs writes several buffers, one after another.
//!
//! Voices are slots, each with its own copy of every voice-section block and its own buffers.
//! Allocation and stealing are decided in JS: the engine is told which slot plays what.
//!
//! Rust notes, for reading this file:
//! - Rust lets you have **one mutable reference or any number of shared ones**, never both at once.
//!   That rules out a whole class of bugs, and it is why `with_node` exists: a node writes its own
//!   buffers while reading the others, so the buffer list is split around them (`split_at_mut`) into
//!   the part before, the node's own buffers, and the part after. The compiler can then see the
//!   writes and the reads never overlap.
//! - The `'a` in `Sources<'a>` is a **lifetime**: a name for "as long as the borrowed buffers live".
//!   It lets the compiler prove a `Sources` is never used after the buffers it points into go away.
//! - `|args| body` is a closure, like an arrow function. `impl FnOnce(...)` accepts any closure that
//!   is called once.
//! - `let Unit::Faust { block, controls } = unit else { return };` takes `unit` apart if it is a
//!   Faust unit, and returns otherwise.

use crate::faust::{self, Block, ParamIndex};
use crate::plan::{
    CHANNELS, MAX_INPUTS, MAX_OUTPUTS, MAX_PORTS, Node, NodeKind, Plan, SIGNAL_FREQ, SIGNAL_GATE, SIGNAL_VELOCITY, Section, Source, StepMode,
    VOICE_SIGNALS,
};

// TS: export const BLOCK = 128; const SLOT = BLOCK + 1; ...
pub const BLOCK: usize = 128;
const SLOT: usize = BLOCK + 1;
/// The most tracks one engine runs (a bank; a phone wants about 16).
pub const MAX_TRACKS: usize = 64;
/// How often control inputs are read, in samples.
const CONTROL: usize = 32;
/// A released voice whose output stays below this for a whole block has finished.
const SILENCE: f32 = 1e-4;
/// A power of two, for masking.
const DELAY_SIZE: usize = 4096;
// TS: x & DELAY_MASK is x % DELAY_SIZE, cheaper because the size is a power of two.
const DELAY_MASK: usize = DELAY_SIZE - 1;
const LONGEST_DELAY: f32 = (DELAY_SIZE - 2) as f32;

/// One buffer: the previous block's last sample, then this block's.
// TS: type Slot = Float32Array (of length SLOT). `[f32; SLOT]` is a fixed-length array: the length
// is part of the type, and it lives inline (no separate heap allocation).
type Slot = [f32; SLOT];
// TS: const SILENT_SLOT = new Float32Array(SLOT)
const SILENT_SLOT: Slot = [0.0; SLOT];
/// What the sections without voices see in place of a voice's signals and the voice sum: silence.
// TS: const NO_SIGNALS = [silent, silent, silent]. A `static` is one value at a fixed address for the
// whole program, so a loan of it (`&NO_SIGNALS`) is valid forever.
static NO_SIGNALS: [Slot; VOICE_SIGNALS] = [SILENT_SLOT; VOICE_SIGNALS];
static NO_VOICE_SUM: [Slot; CHANNELS] = [SILENT_SLOT; CHANNELS];

/// A delay line's state: a ring of past inputs. out[t] = in[t - samples].
// TS: interface DelayLine { ring: Float32Array; write: number }
// `Box<[f32; 4096]>` puts the 16KB ring on the heap rather than inline in the struct.
struct DelayLine {
    ring: Box<[f32; DELAY_SIZE]>,
    write: usize,
}

/// What a node is when it runs: a Faust block with its sliders, or a delay line.
// TS: type Unit = { type: "faust"; block: Block; controls: ParamIndex[] } | { type: "delay"; line: DelayLine }
// A variant can have named fields (`Faust { ... }`) or unnamed ones (`Delay(...)`).
enum Unit {
    Faust { block: Box<Block>, controls: Vec<ParamIndex> },
    Delay(DelayLine),
}

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
struct ParamSource {
    current: f32,
    target: f32,
    buffer: Slot,
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
struct Track {
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

// TS: export class Engine { private sampleRate: number; private tracks: Track[] }
// Fields are private unless marked `pub`; only `Engine` itself is public.
pub struct Engine {
    sample_rate: i32,
    tracks: Vec<Track>,
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

    // TS: clear() { this.units.forEach((unit) => unit.type === "faust" ? unit.block.instanceClear() : unit.line.ring.fill(0)); ... }
    // `iter_mut()` hands out writable loans of each item. `{ block, .. }` takes the `block` field
    // and ignores the rest.
    fn clear(&mut self) {
        self.units.iter_mut().for_each(|unit| match unit {
            Unit::Faust { block, .. } => block.instance_clear(),
            Unit::Delay(line) => line.ring.fill(0.0),
        });
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

impl Unit {
    // TS: static create(node: Node, sampleRate: number): Unit
    fn new(node: &Node, sample_rate: i32) -> Self {
        match node.kind {
            NodeKind::Delay => Unit::Delay(DelayLine { ring: Box::new([0.0; DELAY_SIZE]), write: 0 }),
            NodeKind::Faust(kind) => {
                let mut block = faust::create(kind);
                block.init(sample_rate);
                let controls = faust::controls(&*block);
                Unit::Faust { block, controls }
            }
        }
    }
}

/// What a section reads besides its own buffers. The same for every node in it, so it is built once
/// per section and copied (it is only loans, so copying is cheap).
// TS: interface Context { shared: Slot[]; sharedBase: number[]; signals: Slot[]; voiceSum: Slot[]; inputs: Slot[]; params: ParamSource[]; constants: Slot[] }
// `#[derive(Clone, Copy)]` on a struct of loans: copying it copies the loans, not what they point at.
#[derive(Clone, Copy)]
struct Context<'a> {
    /// The pre section's buffers, and where each of its nodes' outputs start.
    shared: &'a [Slot],
    shared_base: &'a [usize],
    signals: &'a [Slot; VOICE_SIGNALS],
    voice_sum: &'a [Slot; CHANNELS],
    inputs: &'a [Slot; MAX_INPUTS],
    params: &'a [ParamSource],
    constants: &'a [Slot],
}

/// Everything a node reads, with its own buffers split off to be written. A node only reads its own
/// output as a one-sample feedback edge, and then it reads `own`, a copy taken before the split.
// TS: interface Sources { base: number[]; first: number; count: number; before: Slot[]; after: Slot[]; own?: number[]; context: Context }
// Every loan field is read-only (`&'a`), all valid for the same lifetime 'a.
struct Sources<'a> {
    base: &'a [usize],
    /// The node's own buffers are `first .. first + count`, missing from `before` and `after`.
    first: usize,
    count: usize,
    before: &'a [Slot],
    after: &'a [Slot],
    own: Option<[f32; MAX_OUTPUTS]>,
    context: Context<'a>,
}

// TS: function span(slot: Slot, from: number, length: number) { return slot.subarray(from, from + length) }
// The result borrows from `slot`, which the compiler works out from the one `&` argument.
fn span(slot: &Slot, from: usize, length: usize) -> &[f32] {
    &slot[from..from + length]
}

impl<'a> Sources<'a> {
    /// Sources for reading a whole section's buffers, when no node of it is running (its outputs).
    // TS: static whole(base, buffers, context) { return { base, first: buffers.length, count: 0, before: buffers, after: [], context } }
    fn whole(base: &'a [usize], buffers: &'a [Slot], context: Context<'a>) -> Self {
        Sources { base, first: buffers.len(), count: 0, before: buffers, after: &[], own: None, context }
    }

    /// Samples from a node's output in this section, starting at slot index `from`.
    // TS:
    //   if (index < first) return span(before[index], from, length);
    //   if (index >= first + count) return span(after[index - first - count], from, length);
    //   return own.subarray(index - first, index - first + 1);  // a feedback edge onto itself: one sample
    // `&own[i..=i]` is a one-element slice; `..=` includes its end.
    fn buffer(&self, node: usize, port: usize, from: usize, length: usize) -> &[f32] {
        let index = self.base[node] + port;
        if index < self.first {
            span(&self.before[index], from, length)
        } else if index >= self.first + self.count {
            span(&self.after[index - self.first - self.count], from, length)
        } else {
            let own = self.own.as_ref().expect("a node reading itself gets a copy");
            &own[index - self.first..=index - self.first]
        }
    }

    /// Samples [start, start + length) of a source; a feedback edge reads each one a sample early.
    // TS: switch (source.type) { case "buffer": return this.buffer(source.node, source.port, start + 1, length); ... }
    fn samples(&self, source: Source, start: usize, length: usize) -> &[f32] {
        let context = &self.context;
        match source {
            Source::Buffer(node, port) => self.buffer(node, port, start + 1, length),
            Source::Previous(node, port) => self.buffer(node, port, start, length),
            Source::Shared(node, port) => span(&context.shared[context.shared_base[node] + port], start + 1, length),
            Source::Param(param) => span(&context.params[param].buffer, start + 1, length),
            Source::Const(constant) => span(&context.constants[constant], start + 1, length),
            Source::Voice(signal) => span(&context.signals[signal], start + 1, length),
            Source::VoiceSum(channel) => span(&context.voice_sum[channel], start + 1, length),
            Source::Input(channel) => span(&context.inputs[channel], start + 1, length),
        }
    }
}

/// One section while it renders: its units and buffers, and what it reads.
// TS: interface Render { section: Section; units: Unit[]; buffers: Slot[]; context: Context }
// `&'a mut` fields are writable loans: while a Render exists, nothing else can touch those units or
// buffers.
struct Render<'a> {
    section: &'a Section,
    units: &'a mut [Unit],
    buffers: &'a mut [Slot],
    context: Context<'a>,
}

impl Render<'_> {
    /// Run every step of the section, in order.
    fn run(&mut self) {
        // Taking `section` out first (a copy of the loan) lets the loop read it while the steps
        // borrow `self` writable.
        let section = self.section;
        for step in &section.steps {
            match step.mode {
                StepMode::Node => self.run_node(step.nodes[0]),
                StepMode::SampleLoop => self.run_sample_loop(&step.nodes),
                StepMode::ChunkLoop => self.run_chunk_loop(&step.nodes),
            }
        }
    }

    /// Run node `index` from sample `start`, given its outputs and everything it reads.
    // TS: withNode<R>(index: number, start: number, run: (node: Node, unit: Unit, outputs: Slot[], sources: Sources) => R): R
    // In TS you'd just pass `this.buffers` to both. Rust refuses: that would be writable loans of the
    // node's buffers and a readable loan of the same list at once. So:
    fn with_node<R>(&mut self, index: usize, start: usize, run: impl FnOnce(&Node, &mut Unit, &mut [Slot], &Sources) -> R) -> R {
        let section = self.section;
        let node = &section.nodes[index];
        let (first, count) = (section.base[index], node.outputs);
        // TS: const own = node.readsItself ? ports.map((port) => buffers[first + port][start]) : undefined
        // `bool.then(|| x)` is `cond ? x : undefined`. `std::array::from_fn(f)` builds a fixed array
        // from f(0), f(1), ...: here the sample before `start` of each of its own outputs, copied, so
        // the copy is free of the loan.
        let own = node.reads_itself.then(|| std::array::from_fn(|port| if port < count { self.buffers[first + port][start] } else { 0.0 }));
        // TS: const [before, rest] = [buffers.slice(0, first), buffers.slice(first)]  (but views, not copies)
        // `split_at_mut` gives two writable views that provably don't overlap.
        let (before, rest) = self.buffers.split_at_mut(first);
        let (outputs, after) = rest.split_at_mut(count);
        // `before` and `after` were writable views; putting them in fields typed `&'a [Slot]` turns
        // them read-only, which is all Sources needs.
        let sources = Sources { base: &section.base, first, count, before, after, own, context: self.context };
        run(node, &mut self.units[index], outputs, &sources)
    }

    /// Read the control inputs at sample `start` into the block's sliders, then run it over the chunk.
    fn run_faust(&mut self, index: usize, start: usize, length: usize, set_controls: bool) {
        self.with_node(index, start, |node, unit, outputs, sources| {
            // TS: if (unit.type !== "faust") return; const { block, controls } = unit;
            let Unit::Faust { block, controls } = unit else { return };
            if set_controls {
                // TS: controls.forEach((param, i) => block.setParam(param, sources.samples(node.control[i], start, 1)[0]))
                // `.zip(other)` walks two lists in step, giving pairs. `|(&param, &source)|`
                // destructures the pair and copies both values out of their references.
                controls.iter().zip(&node.control).for_each(|(&param, &source)| {
                    block.set_param(param, sources.samples(source, start, 1)[0]);
                });
            }
            // TS: const inputs = node.audio.map((source) => sources.samples(source, start, length))
            // Written as fixed arrays of empty slices (`Default::default()`), then filled, so nothing
            // is allocated on the heap mid-render (a Vec would be). `*input = ...` writes through the
            // writable loan.
            let mut inputs: [&[f32]; MAX_PORTS] = Default::default();
            inputs.iter_mut().zip(&node.audio).for_each(|(input, &source)| {
                *input = sources.samples(source, start, length);
            });
            // TS: const outs = outputs.map((slot) => slot.subarray(start + 1, start + 1 + length))
            let mut outs: [&mut [f32]; MAX_OUTPUTS] = Default::default();
            outs.iter_mut().zip(outputs.iter_mut()).for_each(|(out, slot)| {
                *out = &mut slot[start + 1..start + 1 + length];
            });
            block.compute(length as i32, &inputs[..node.audio.len()], &mut outs[..node.outputs]);
        });
    }

    /// A delay outside any loop: write each sample then read, so a delay of 0 passes straight through.
    fn run_delay(&mut self, index: usize) {
        self.with_node(index, 0, |node, unit, outputs, sources| {
            let Unit::Delay(line) = unit else { return };
            let input = sources.samples(node.audio[0], 0, BLOCK);
            let lengths = sources.samples(node.audio[1], 0, BLOCK);
            // TS: for (let i = 0; i < BLOCK; i++) { line.ring[line.write] = input[i]; outputs[0][i + 1] = line.tap(0, clamp(lengths[i])); line.write = (line.write + 1) & DELAY_MASK; }
            // Zipping three lists gives nested pairs, `((sample, length), out)`.
            input.iter().zip(lengths).zip(&mut outputs[0][1..]).for_each(|((&sample, &length), out)| {
                line.ring[line.write] = sample;
                *out = line.tap(0, length.min(LONGEST_DELAY).max(0.0));
                line.write = (line.write + 1) & DELAY_MASK;
            });
        });
    }

    /// A delay's output over [start, start + length), from what it has already been given.
    fn delay_read(&mut self, index: usize, start: usize, length: usize) {
        self.with_node(index, start, |node, unit, outputs, sources| {
            let Unit::Delay(line) = unit else { return };
            let lengths = sources.samples(node.audio[1], start, length);
            let output = &mut outputs[0][start + 1..start + 1 + length];
            // `write` is where sample `start` will go: each output is offset samples on from it.
            // TS: lengths.forEach((delay, offset) => (output[offset] = line.tap(offset, clamp(delay))))
            lengths.iter().zip(output).enumerate().for_each(|(offset, (&delay, out))| {
                *out = line.tap(offset, delay.min(LONGEST_DELAY).max(1.0));
            });
        });
    }

    /// Give a delay its input over [start, start + length).
    fn delay_write(&mut self, index: usize, start: usize, length: usize) {
        // `_outputs`: given but unused, hence the underscore.
        self.with_node(index, start, |node, unit, _outputs, sources| {
            let Unit::Delay(line) = unit else { return };
            // In a one-sample loop the input can be a feedback edge, read as the sample before.
            sources.samples(node.audio[0], start, length).iter().for_each(|&sample| {
                line.ring[line.write] = sample;
                line.write = (line.write + 1) & DELAY_MASK;
            });
        });
    }

    fn is_delay(&self, index: usize) -> bool {
        self.section.nodes[index].is_delay()
    }

    // TS: if (isDelay) return runDelay(index); for (let start = 0; start < BLOCK; start += CONTROL) runFaust(...)
    // `(0..BLOCK).step_by(CONTROL)` is 0, 32, 64, 96.
    fn run_node(&mut self, index: usize) {
        if self.is_delay(index) {
            return self.run_delay(index);
        }
        (0..BLOCK).step_by(CONTROL).for_each(|start| self.run_faust(index, start, CONTROL, true));
    }

    // TS: for (let sample = 0; sample < BLOCK; sample++) for (const index of members) { ... }
    // `for &index in members` copies each number out of its reference as it goes.
    fn run_sample_loop(&mut self, members: &[usize]) {
        for sample in 0..BLOCK {
            for &index in members {
                if self.is_delay(index) {
                    self.delay_read(index, sample, 1);
                    self.delay_write(index, sample, 1);
                } else {
                    self.run_faust(index, sample, 1, sample % CONTROL == 0);
                }
            }
        }
    }

    /// A loop cut by delays: every delay reads its chunk first (it only needs what it was given
    /// before), the rest run in order over the chunk, then every delay takes its input. Exact as
    /// long as the chunk is no longer than the shortest delay, so the chunk is set from the delay
    /// lengths over this block.
    fn run_chunk_loop(&mut self, members: &[usize]) {
        // Taking `section` out first (a copy of the loan) lets the closures below read its nodes
        // without borrowing `self`, which the loop body needs writable.
        let section = self.section;
        let nodes = &section.nodes;
        // TS: const delays = () => members.filter((index) => nodes[index].isDelay())
        // These return lazy iterators, so each call starts a fresh pass without building a list.
        let delays = || members.iter().copied().filter(|&index| nodes[index].is_delay());
        let rest = || members.iter().copied().filter(|&index| !nodes[index].is_delay());
        // TS: const shortest = delays().reduce((shortest, index) => Math.min(shortest, ...lengthsOf(index)), BLOCK)
        // `fold(start, f)` is `reduce(f, start)`.
        let shortest = delays().fold(BLOCK as f32, |shortest, index| {
            let lengths = nodes[index].audio[1];
            self.with_node(index, 0, |_, _, _, sources| {
                sources.samples(lengths, 0, BLOCK).iter().fold(shortest, |shortest, &length| shortest.min(length))
            })
        });
        // Control inputs are still read every CONTROL samples, so a chunk never crosses one of those.
        // TS: const chunk = Math.min(Math.max(Math.trunc(shortest), 1), CONTROL)
        let chunk = (shortest as i32).clamp(1, CONTROL as i32) as usize;
        for start in (0..BLOCK).step_by(chunk) {
            let length = chunk.min(BLOCK - start);
            delays().for_each(|index| self.delay_read(index, start, length));
            rest().for_each(|index| self.run_faust(index, start, length, true));
            delays().for_each(|index| self.delay_write(index, start, length));
        }
    }
}

impl DelayLine {
    /// The input `delay` samples before position `write + offset`, interpolated linearly.
    // TS: `delay as usize` is Math.trunc(delay); the rest is the same arithmetic.
    fn tap(&self, offset: usize, delay: f32) -> f32 {
        let whole = delay as usize;
        let fraction = delay - whole as f32;
        let newer = (self.write + offset + DELAY_SIZE - whole) & DELAY_MASK;
        let older = (newer + DELAY_MASK) & DELAY_MASK;
        self.ring[newer] * (1.0 - fraction) + self.ring[older] * fraction
    }
}

impl Track {
    // TS: static create(): Track, with no plan: silent until one loads.
    fn new() -> Self {
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
    fn load(&mut self, plan: Plan, sample_rate: i32) {
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
    fn process(&mut self) {
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
    fn note_on(&mut self, slot: usize, offset: i32, frequency: f32, velocity: f32) {
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
    fn note_off(&mut self, slot: usize, offset: i32) {
        let Some(voice) = self.voices.get_mut(slot).filter(|voice| voice.active) else { return };
        voice.released = true;
        voice.fill_signal(SIGNAL_GATE, offset, 0.0);
    }
}

impl Engine {
    // TS: constructor(). `const fn` can also run at compile time, which lib.rs needs to set up the
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
    // TS: const param = this.tracks[track]?.params[source]; if (param) param.target = value;
    // `.and_then(f)` chains a second safe lookup, like `?.`.
    pub fn set_param(&mut self, track: usize, source: usize, value: f32) {
        if let Some(param) = self.tracks.get_mut(track).and_then(|track| track.params.get_mut(source)) {
            param.target = value;
        }
    }

    /// Jump a track param to a value with no ramp (initial values).
    // `*param = ...` replaces the whole value the loan points at.
    pub fn init_param(&mut self, track: usize, source: usize, value: f32) {
        if let Some(param) = self.tracks.get_mut(track).and_then(|track| track.params.get_mut(source)) {
            *param = ParamSource { current: value, target: value, buffer: [value; SLOT] };
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

    // TS: return this.tracks[track]?.voices[slot]?.active ?? false
    pub fn voice_active(&self, track: usize, slot: usize) -> bool {
        self.tracks.get(track).and_then(|track| track.voices.get(slot)).is_some_and(|voice| voice.active)
    }

    /// Render one block of every track.
    // TS: this.tracks.forEach((track) => track.process())
    // `Track::process` names the method as a function, so it can be passed like `(track) => track.process()`.
    pub fn process(&mut self) {
        self.tracks.iter_mut().for_each(Track::process);
    }

    /// A track's output channel for the block just rendered.
    // TS: return this.tracks[track]?.output[channel]
    pub fn output(&self, track: usize, channel: usize) -> Option<&[f32; BLOCK]> {
        self.tracks.get(track).and_then(|track| track.output.get(channel))
    }

    /// A track's audio input channel, for the next block, to be written before `process`.
    // TS: return this.tracks[track]?.inputs[channel]?.subarray(1)
    pub fn input_mut(&mut self, track: usize, channel: usize) -> Option<&mut [f32]> {
        self.tracks.get_mut(track).and_then(|track| track.inputs.get_mut(channel)).map(|slot| &mut slot[1..])
    }
}
