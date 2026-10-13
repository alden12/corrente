//! The router: runs a plan's steps over every active voice, one 128-sample block at a time.
//!
//! - **Audio inputs** are buffers handed to a block's compute. **Control inputs** are Faust sliders,
//!   set from their source every CONTROL samples, so a filter recomputes its coefficients 4 times a
//!   block rather than 128.
//! - **A step** is one node over the block, or a feedback loop. A loop whose every cycle passes
//!   through a delay runs in chunks as long as the shortest delay (delays read first, write last).
//!   Any other loop runs one sample at a time, its feedback edges reading the sample before.
//! - **The delay is native**, not Faust: it has to split into a read and a write around the rest of
//!   the loop.
//!
//! Every buffer is a `Slot` of 129 floats: slot 0 holds the last sample of the previous block,
//! 1..=128 the current one, so a feedback edge reads "the sample before" by offset, even at sample 0.
//!
//! Voices are slots, each with its own copy of every block and its own buffers; params are shared.
//! Allocation and stealing are decided in JS: the engine is told which slot plays what.
//!
//! Rust notes, for reading this file:
//! - Rust lets you have **one mutable reference or any number of shared ones**, never both at once.
//!   That rules out a whole class of bugs, and it is why `with_node` exists: a node writes its own
//!   buffer while reading the others, so the buffer list is split around it (`split_at_mut`) into
//!   the part before, the node's own buffer, and the part after. The compiler can then see the write
//!   and the reads never overlap.
//! - The `'a` in `Sources<'a>` is a **lifetime**: a name for "as long as the borrowed buffers live".
//!   It lets the compiler prove a `Sources` is never used after the buffers it points into go away.
//! - `|args| body` is a closure, like an arrow function. `impl FnOnce(...)` accepts any closure that
//!   is called once.
//! - `let Unit::Faust { block, controls } = unit else { return };` takes `unit` apart if it is a
//!   Faust unit, and returns otherwise.

// TS: import { faust, Block, ParamIndex } from "./faust"; import { MAX_PORTS, ... } from "./plan";
// `self` in the list imports the module itself too, so both `faust::create` and `Block` work.
use crate::faust::{self, Block, ParamIndex};
use crate::plan::{MAX_PORTS, Node, NodeKind, Plan, SIGNAL_GATE, SIGNAL_FREQ, SIGNAL_VELOCITY, Source, StepMode, VOICE_SIGNALS};

// TS: export const BLOCK = 128; const SLOT = BLOCK + 1; ...
pub const BLOCK: usize = 128;
const SLOT: usize = BLOCK + 1;
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

/// A delay line's state in one voice: a ring of past inputs. out[t] = in[t - samples].
// TS: interface DelayLine { ring: Float32Array; write: number }
// `Box<[f32; 4096]>` puts the 16KB ring on the heap rather than inline in the struct.
struct DelayLine {
    ring: Box<[f32; DELAY_SIZE]>,
    write: usize,
}

/// What a node is in one voice: a Faust block with its sliders, or a delay line.
// TS: type Unit = { type: "faust"; block: Block; controls: ParamIndex[] } | { type: "delay"; line: DelayLine }
// A variant can have named fields (`Faust { ... }`) or unnamed ones (`Delay(...)`).
enum Unit {
    Faust { block: Box<Block>, controls: Vec<ParamIndex> },
    Delay(DelayLine),
}

// TS: interface Voice { units: Unit[]; buffers: Slot[]; signals: [Slot, Slot, Slot]; current: [number, number, number]; active: boolean; released: boolean }
struct Voice {
    units: Vec<Unit>,
    buffers: Vec<Slot>,
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
        Self { current: 0.0, target: 0.0, buffer: [0.0; SLOT] }
    }
}

// TS: export class Engine { private sampleRate: number; private plan?: Plan; ... }
// Fields are private unless marked `pub`; only `Engine` itself is public.
pub struct Engine {
    sample_rate: i32,
    plan: Option<Plan>,
    params: Vec<ParamSource>,
    constants: Vec<Slot>,
    voices: Vec<Voice>,
    master: [f32; BLOCK],
}

impl Voice {
    // TS: static create(plan: Plan | undefined, sampleRate: number): Voice
    // `Option<&Plan>` is "maybe a loan of a plan". `&[][..]` is an empty list of nodes, used when
    // there's no plan.
    fn new(plan: Option<&Plan>, sample_rate: i32) -> Self {
        let nodes = plan.map_or(&[][..], |plan| &plan.nodes);
        Voice {
            units: nodes.iter().map(|node| Unit::new(node, sample_rate)).collect(),
            // TS: Array.from({ length: nodes.length }, () => new Float32Array(SLOT))
            buffers: vec![[0.0; SLOT]; nodes.len()],
            signals: [[0.0; SLOT]; VOICE_SIGNALS],
            current: [0.0; VOICE_SIGNALS],
            active: false,
            released: false,
        }
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

/// Everything a node reads, with its own buffer split off to be written. A node only reads its own
/// buffer as a one-sample feedback edge, and then it reads a copy taken before the split.
// TS: interface Sources { index: number; before: Slot[]; after: Slot[]; own?: Slot; ... }
// Every field is a read-only loan (`&'a`), all valid for the same lifetime 'a.
struct Sources<'a> {
    index: usize,
    before: &'a [Slot],
    after: &'a [Slot],
    own: Option<&'a Slot>,
    signals: &'a [Slot; VOICE_SIGNALS],
    params: &'a [ParamSource],
    constants: &'a [Slot],
}

// `impl<'a> Sources<'a>` declares 'a so the methods can promise their results live as long as the
// buffers, not just as long as the `Sources` value.
impl<'a> Sources<'a> {
    // TS:
    //   slot(source: Source): Slot {
    //     switch (source.type) {
    //       case "buffer": case "previous":
    //         if (source.node < this.index) return this.before[source.node];
    //         if (source.node > this.index) return this.after[source.node - this.index - 1];
    //         return this.own!;
    //       case "param": return this.params[source.param].buffer; ...
    //     }
    //   }
    // `node.cmp(&other)` compares, giving Less, Greater or Equal. `.expect(msg)` is TS's `!`, but
    // checked: it stops the program with `msg` if the value is missing.
    fn slot(&self, source: Source) -> &'a Slot {
        match source {
            Source::Buffer(node) | Source::Previous(node) => match node.cmp(&self.index) {
                std::cmp::Ordering::Less => &self.before[node],
                std::cmp::Ordering::Greater => &self.after[node - self.index - 1],
                std::cmp::Ordering::Equal => self.own.expect("a node reading itself gets a copy"),
            },
            Source::Param(param) => &self.params[param].buffer,
            Source::Const(constant) => &self.constants[constant],
            Source::Voice(signal) => &self.signals[signal],
        }
    }

    /// Samples [start, start + length) of a source; a feedback edge reads each one a sample early.
    // TS: const from = source.type === "previous" ? start : start + 1; return this.slot(source).subarray(from, from + length);
    fn samples(&self, source: Source, start: usize, length: usize) -> &'a [f32] {
        let from = if matches!(source, Source::Previous(_)) { start } else { start + 1 };
        &self.slot(source)[from..from + length]
    }
}

/// A voice's state while it renders: its units and buffers, and what every voice shares.
// TS: interface Render { nodes: Node[]; units: Unit[]; buffers: Slot[]; ... }
// `&'a mut` fields are writable loans: while a Render exists, nothing else can touch that voice's
// units or buffers.
struct Render<'a> {
    nodes: &'a [Node],
    units: &'a mut [Unit],
    buffers: &'a mut [Slot],
    signals: &'a [Slot; VOICE_SIGNALS],
    params: &'a [ParamSource],
    constants: &'a [Slot],
}

impl Render<'_> {
    /// Run node `index` over [start, start + length), given its output and everything it reads.
    // TS: withNode<R>(index: number, run: (node: Node, unit: Unit, output: Slot, sources: Sources) => R): R
    // In TS you'd just pass `this.buffers[index]` and `this.buffers` together. Rust refuses: that
    // would be a writable loan of one buffer and a readable loan of the same list at once. So:
    fn with_node<R>(&mut self, index: usize, run: impl FnOnce(&Node, &mut Unit, &mut Slot, &Sources) -> R) -> R {
        let node = &self.nodes[index];
        // TS: const ownCopy = node.readsItself ? this.buffers[index].slice() : undefined
        // `bool.then(|| x)` is `cond ? x : undefined`. Indexing a Slot here copies it (arrays of
        // numbers are Copy), so the copy is free of the loan.
        let own_copy = node.reads_itself.then(|| self.buffers[index]);
        // TS: const [before, rest] = [buffers.slice(0, index), buffers.slice(index)]  (but views, not copies)
        // `split_at_mut` gives two writable views that provably don't overlap.
        let (before, rest) = self.buffers.split_at_mut(index);
        // TS: const [output, ...after] = rest. `split_first_mut` returns None for an empty list.
        let (output, after) = rest.split_first_mut().expect("the plan checked every node index");
        // `before` and `after` were writable views; putting them in fields typed `&'a [Slot]` turns
        // them read-only, which is all Sources needs.
        let sources = Sources {
            index,
            before,
            after,
            own: own_copy.as_ref(),
            signals: self.signals,
            params: self.params,
            constants: self.constants,
        };
        run(node, &mut self.units[index], output, &sources)
    }

    /// Read the control inputs at sample `at` into the block's sliders, then run it over the chunk.
    fn run_faust(&mut self, index: usize, start: usize, length: usize, set_controls: bool) {
        self.with_node(index, |node, unit, output, sources| {
            // TS: if (unit.type !== "faust") return; const { block, controls } = unit;
            let Unit::Faust { block, controls } = unit else { return };
            if set_controls {
                // TS: controls.forEach((param, i) => block.setParam(param, sources.slot(node.control[i])[start + 1]))
                // `.zip(other)` walks two lists in step, giving pairs. `|(&param, &source)|`
                // destructures the pair and copies both values out of their references.
                controls.iter().zip(&node.control).for_each(|(&param, &source)| {
                    block.set_param(param, sources.slot(source)[start + 1]);
                });
            }
            // TS: const inputs = node.audio.map((source) => sources.samples(source, start, length))
            // Written as a fixed array of 16 empty slices, then filled, so nothing is allocated on
            // the heap mid-render (a Vec would be). `*input = ...` writes through the writable loan.
            let mut inputs: [&[f32]; MAX_PORTS] = [&[]; MAX_PORTS];
            inputs.iter_mut().zip(&node.audio).for_each(|(input, &source)| {
                *input = sources.samples(source, start, length);
            });
            // TS: const out = output.subarray(start + 1, start + 1 + length); block.compute(length, inputs, [out]);
            let output = &mut output[start + 1..start + 1 + length];
            block.compute(length as i32, &inputs[..node.audio.len()], &mut [output]);
        });
    }

    /// A delay outside any loop: write each sample then read, so a delay of 0 passes straight through.
    fn run_delay(&mut self, index: usize) {
        self.with_node(index, |node, unit, output, sources| {
            let Unit::Delay(line) = unit else { return };
            let input = sources.samples(node.audio[0], 0, BLOCK);
            let lengths = sources.samples(node.audio[1], 0, BLOCK);
            // TS: for (let i = 0; i < BLOCK; i++) { line.ring[line.write] = input[i]; output[i + 1] = line.tap(0, clamp(lengths[i])); line.write = (line.write + 1) & DELAY_MASK; }
            // Zipping three lists gives nested pairs, `((sample, length), out)`.
            input.iter().zip(lengths).zip(&mut output[1..]).for_each(|((&sample, &length), out)| {
                line.ring[line.write] = sample;
                *out = line.tap(0, length.min(LONGEST_DELAY).max(0.0));
                line.write = (line.write + 1) & DELAY_MASK;
            });
        });
    }

    /// A delay's output over [start, start + length), from what it has already been given.
    fn delay_read(&mut self, index: usize, start: usize, length: usize) {
        self.with_node(index, |node, unit, output, sources| {
            let Unit::Delay(line) = unit else { return };
            let lengths = sources.samples(node.audio[1], start, length);
            let output = &mut output[start + 1..start + 1 + length];
            // `write` is where sample `start` will go: each output is offset samples on from it.
            // TS: lengths.forEach((delay, offset) => (output[offset] = line.tap(offset, clamp(delay))))
            lengths.iter().zip(output).enumerate().for_each(|(offset, (&delay, out))| {
                *out = line.tap(offset, delay.min(LONGEST_DELAY).max(1.0));
            });
        });
    }

    /// Give a delay its input over [start, start + length).
    fn delay_write(&mut self, index: usize, start: usize, length: usize) {
        // `_output`: given but unused, hence the underscore.
        self.with_node(index, |node, unit, _output, sources| {
            let Unit::Delay(line) = unit else { return };
            // In a one-sample loop the input can be a feedback edge, read as the sample before.
            sources.samples(node.audio[0], start, length).iter().for_each(|&sample| {
                line.ring[line.write] = sample;
                line.write = (line.write + 1) & DELAY_MASK;
            });
        });
    }

    fn is_delay(&self, index: usize) -> bool {
        self.nodes[index].is_delay()
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
        // Taking `nodes` out first (a copy of the loan) lets the closures below read it without
        // borrowing `self`, which the loop body needs writable.
        let nodes = self.nodes;
        // TS: const delays = () => members.filter((index) => nodes[index].isDelay())
        // These return lazy iterators, so each call starts a fresh pass without building a list.
        let delays = || members.iter().copied().filter(|&index| nodes[index].is_delay());
        let rest = || members.iter().copied().filter(|&index| !nodes[index].is_delay());
        // TS: const shortest = delays().reduce((shortest, index) => Math.min(shortest, ...lengthsOf(index)), BLOCK)
        // `fold(start, f)` is `reduce(f, start)`.
        let shortest = delays().fold(BLOCK as f32, |shortest, index| {
            let lengths = nodes[index].audio[1];
            self.with_node(index, |_, _, _, sources| {
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

impl Engine {
    // TS: constructor(). `const fn` can also run at compile time, which lib.rs needs to set up the
    // one engine before anything calls it.
    pub const fn new() -> Self {
        Engine {
            sample_rate: 48000,
            plan: None,
            params: Vec::new(),
            constants: Vec::new(),
            voices: Vec::new(),
            master: [0.0; BLOCK],
        }
    }

    // TS: init(sampleRate, maxVoices) { this.voices = Array.from({ length: maxVoices }, () => Voice.create(this.plan, sampleRate)); return faust.COUNT }
    // `self.plan.as_ref()` turns `Option<Plan>` into `Option<&Plan>`: lends the plan rather than
    // moving it out of the engine.
    pub fn init(&mut self, sample_rate: i32, max_voices: usize) -> i32 {
        self.sample_rate = sample_rate;
        self.voices = (0..max_voices).map(|_| Voice::new(self.plan.as_ref(), sample_rate)).collect();
        faust::COUNT as i32
    }

    /// Replace the voice graph. Sounding voices are cut for now; crossfading them into the new plan
    /// comes with the engine client (INST-36.5).
    // `plan: Plan` (no `&`) takes ownership: the caller hands the plan over, and the engine keeps it
    // in `self.plan` at the end. Assigning over the old voices and plan frees them.
    pub fn load(&mut self, plan: Plan) {
        if self.params.len() != plan.param_count {
            self.params = vec![ParamSource::default(); plan.param_count];
        }
        // TS: this.constants = plan.constants.map((value) => new Float32Array(SLOT).fill(value))
        self.constants = plan.constants.iter().map(|&value| [value; SLOT]).collect();
        self.voices = (0..self.voices.len()).map(|_| Voice::new(Some(&plan), self.sample_rate)).collect();
        self.plan = Some(plan);
    }

    /// Set a param source's value; it ramps there over the next block.
    // TS: const param = this.params[source]; if (param) param.target = value;
    // `get_mut` is a safe index giving a writable loan, or None past the end.
    pub fn set_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.params.get_mut(source) {
            param.target = value;
        }
    }

    /// Jump a param source to a value with no ramp (initial values).
    // TS: if (this.params[source]) this.params[source] = { current: value, target: value, buffer: filled(value) }
    // `*param = ...` replaces the whole value the loan points at.
    pub fn init_param(&mut self, source: usize, value: f32) {
        if let Some(param) = self.params.get_mut(source) {
            *param = ParamSource { current: value, target: value, buffer: [value; SLOT] };
        }
    }

    /// Start a note in a voice slot, `offset` samples into the coming block. A busy slot is reset
    /// (stolen).
    // TS: const voice = this.voices[slot]; if (!voice) return; ...
    // `let Some(voice) = ... else { return };` is that, in one line.
    pub fn note_on(&mut self, slot: usize, offset: i32, frequency: f32, velocity: f32) {
        let Some(voice) = self.voices.get_mut(slot) else { return };
        if !voice.active {
            (0..VOICE_SIGNALS).for_each(|signal| voice.fill_signal(signal, -1, 0.0));
        }
        voice.clear();
        voice.active = true;
        voice.released = false;
        voice.fill_signal(SIGNAL_FREQ, offset, frequency);
        voice.fill_signal(SIGNAL_VELOCITY, offset, velocity);
        voice.fill_signal(SIGNAL_GATE, offset, 1.0);
    }

    // TS: const voice = this.voices[slot]; if (!voice?.active) return; voice.released = true; ...
    pub fn note_off(&mut self, slot: usize, offset: i32) {
        let Some(voice) = self.voices.get_mut(slot).filter(|voice| voice.active) else { return };
        voice.released = true;
        voice.fill_signal(SIGNAL_GATE, offset, 0.0);
    }

    // TS: return this.voices[slot]?.active ?? false
    pub fn voice_active(&self, slot: usize) -> bool {
        self.voices.get(slot).is_some_and(|voice| voice.active)
    }

    /// Render one block of every active voice, summed. Returns the 128-sample mono mix.
    // Returns `&[f32; BLOCK]`, a read-only loan of the engine's own mix, valid until the engine is
    // next changed: the caller reads it without a copy.
    pub fn process(&mut self) -> &[f32; BLOCK] {
        self.master.fill(0.0);
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
        // TS: const plan = this.plan; if (!plan) return this.master; const out = plan.out; if (out === undefined) return this.master;
        let Some(plan) = &self.plan else { return &self.master };
        let Some(out) = plan.out else { return &self.master };
        // TS: for (const voice of this.voices.filter((voice) => voice.active))
        // Rust can see that `plan` reads `self.plan` while `voice` writes `self.voices`: different
        // fields, so both loans are allowed at once.
        for voice in self.voices.iter_mut().filter(|voice| voice.active) {
            let mut render = Render {
                nodes: &plan.nodes,
                units: &mut voice.units,
                buffers: &mut voice.buffers,
                signals: &voice.signals,
                params: &self.params,
                constants: &self.constants,
            };
            for step in &plan.steps {
                match step.mode {
                    StepMode::Node => render.run_node(step.nodes[0]),
                    StepMode::SampleLoop => render.run_sample_loop(&step.nodes),
                    StepMode::ChunkLoop => render.run_chunk_loop(&step.nodes),
                }
            }
            // `render` is not used after this point, so its writable loans of the voice end here,
            // and the lines below may read the voice's buffers again.
            // Velocity scales the voice on the way out, as the Web Audio engine's `amp` does.
            let output = &voice.buffers[out][1..];
            let velocity = &voice.signals[SIGNAL_VELOCITY][1..];
            // `0.0f32` is a literal typed as f32.
            let mut peak = 0.0f32;
            // TS: master.forEach((_, i) => { master[i] += output[i] * velocity[i]; peak = Math.max(peak, Math.abs(output[i])) })
            self.master.iter_mut().zip(output).zip(velocity).for_each(|((mix, &sample), &gain)| {
                *mix += sample * gain;
                peak = peak.max(sample.abs());
            });
            // Carry each buffer's last sample into slot 0, for feedback edges in the next block.
            voice.buffers.iter_mut().for_each(|buffer| buffer[0] = buffer[BLOCK]);
            voice.signals.iter_mut().zip(voice.current).for_each(|(signal, value)| signal.fill(value));
            if voice.released && peak < SILENCE {
                voice.active = false;
            }
        }
        &self.master
    }
}
