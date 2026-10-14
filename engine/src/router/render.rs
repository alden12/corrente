//! Running one section: its steps in order, each a node over the block, a one-sample loop, or a loop
//! cut by delays and run in chunks.
//!
//! Rust notes, for reading this file:
//! - Rust lets you have **one mutable reference or any number of shared ones**, never both at once.
//!   That rules out a whole class of bugs, and it is why `with_node` exists: a node writes its own
//!   buffers while reading the others, so the buffer list is split around them (`split_at_mut`) into
//!   the part before, the node's own buffers, and the part after. The compiler can then see the
//!   writes and the reads never overlap.
//! - `|args| body` is a closure, like an arrow function. `impl FnOnce(...)` accepts any closure that
//!   is called once.
//! - `let Unit::Faust { block, controls, .. } = unit else { return };` takes `unit` apart if it is a
//!   Faust unit, and returns otherwise; `..` skips the fields it doesn't name.

use super::delay::{DEFAULT_SIZE, DelayLine};
use super::sampler::SamplerState;
use super::wavetable::WavetableState;
use super::sources::{Context, Sources};
use super::{BLOCK, CONTROL, Slot};
use crate::faust::{self, Block, ParamIndex};
use crate::plan::{MAX_OUTPUTS, MAX_PORTS, Node, NodeKind, Section, Source, StepMode};

/// What a node is when it runs: a Faust block with its sliders, a delay line, a sample player or a
/// wavetable oscillator.
// TS: type Unit = { type: "faust"; block: Block; controls: ParamIndex[]; meters: ParamIndex[] } | { type: "delay"; line: DelayLine } | { type: "sampler"; state: SamplerState } | { type: "wavetable"; state: WavetableState }
// A variant can have named fields (`Faust { ... }`) or unnamed ones (`Delay(...)`).
pub(super) enum Unit {
    Faust { block: Box<Block>, controls: Vec<ParamIndex>, meters: Vec<ParamIndex> },
    Delay(DelayLine),
    Sampler(SamplerState),
    Wavetable(WavetableState),
}

impl Unit {
    /// The unit for a node, made when its plan loads. `constants` are the plan's literals, which a
    /// delay's `size` is read from.
    pub(super) fn new(node: &Node, sample_rate: i32, constants: &[f32]) -> Self {
        match node.kind {
            // TS: const size = node.control[0]?.type === "const" ? constants[node.control[0].index] : DEFAULT_SIZE
            NodeKind::Delay => Unit::Delay(DelayLine::new(match node.control.first() {
                Some(&Source::Const(index)) => constants[index].max(0.0) as usize,
                _ => DEFAULT_SIZE,
            })),
            NodeKind::Sampler => Unit::Sampler(SamplerState::new(sample_rate)),
            NodeKind::Wavetable => Unit::Wavetable(WavetableState::new(sample_rate)),
            NodeKind::Faust(kind) => {
                let mut block = faust::create(kind);
                block.init(sample_rate);
                // TS: const { controls, meters } = faust.ports(block)
                let faust::Ports { controls, meters } = faust::ports(&*block);
                Unit::Faust { block, controls, meters }
            }
        }
    }

    // TS: clear() { switch (this.type) { case "faust": this.block.instanceClear(); ... } }
    // `match self` on `&mut self`: each arm gets a writable loan of what the variant holds.
    pub(super) fn clear(&mut self) {
        match self {
            Unit::Faust { block, .. } => block.instance_clear(),
            Unit::Delay(line) => line.clear(),
            Unit::Sampler(state) => state.clear(),
            Unit::Wavetable(state) => state.clear(),
        }
    }

    /// Whether `other` holds state this unit could take over (INST-36.7): the same node kind is
    /// checked by the plan, so only a delay's ring length can differ.
    // TS: return this.type !== "delay" || (other.type === "delay" && other.line.length === this.line.length)
    // A `match` on a pair: each arm is one combination, `_` anything.
    pub(super) fn fits(&self, other: &Unit) -> bool {
        match (self, other) {
            (Unit::Delay(line), Unit::Delay(other)) => line.length() == other.length(),
            (Unit::Delay(_), _) => false,
            _ => true,
        }
    }

    /// The value a block's meter `index` shows, or None if it has no such meter.
    // TS: return this.type === "faust" ? (this.meters[index] !== undefined ? this.block.getParam(this.meters[index]) : undefined) : undefined
    // `let ... else` again; then `?` on Options, returning None as soon as a lookup comes up empty.
    pub(super) fn meter(&self, index: usize) -> Option<f32> {
        let Unit::Faust { block, meters, .. } = self else { return None };
        block.get_param(*meters.get(index)?)
    }
}

/// One section while it renders: its units and buffers, and what it reads.
// `&'a mut` fields are writable loans: while a Render exists, nothing else can touch those units or
// buffers.
pub(super) struct Render<'a> {
    pub(super) section: &'a Section,
    pub(super) units: &'a mut [Unit],
    pub(super) buffers: &'a mut [Slot],
    pub(super) context: Context<'a>,
}

impl Render<'_> {
    /// Run every step of the section, in order.
    pub(super) fn run(&mut self) {
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
    pub(super) fn with_node<R>(&mut self, index: usize, start: usize, run: impl FnOnce(&Node, &mut Unit, &mut [Slot], &Sources) -> R) -> R {
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
            let Unit::Faust { block, controls, .. } = unit else { return };
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

    fn is_delay(&self, index: usize) -> bool {
        self.section.nodes[index].is_delay()
    }

    /// Run a node that isn't a delay over [start, start + length): a Faust block, a sampler or a
    /// wavetable.
    // TS: ({ sampler: runSampler, wavetable: runWavetable })[kind.type]?.(...) ?? this.runFaust(...)
    fn run_unit(&mut self, index: usize, start: usize, length: usize, set_controls: bool) {
        match self.section.nodes[index].kind {
            NodeKind::Sampler => self.run_sampler(index, start, length, set_controls),
            NodeKind::Wavetable => self.run_wavetable(index, start, length, set_controls),
            _ => self.run_faust(index, start, length, set_controls),
        }
    }

    // TS: if (isDelay) return runDelay(index); for (let start = 0; start < BLOCK; start += CONTROL) runUnit(...)
    // `(0..BLOCK).step_by(CONTROL)` is 0, 32, 64, 96.
    fn run_node(&mut self, index: usize) {
        if self.is_delay(index) {
            return self.run_delay(index);
        }
        (0..BLOCK).step_by(CONTROL).for_each(|start| self.run_unit(index, start, CONTROL, true));
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
                    self.run_unit(index, sample, 1, sample % CONTROL == 0);
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
        // A delay plays no longer than its ring holds, however long it's asked for.
        // TS: const shortest = delays().reduce((shortest, index) => Math.min(shortest, line(index).longest, ...lengthsOf(index)), BLOCK)
        // `fold(start, f)` is `reduce(f, start)`.
        let shortest = delays().fold(BLOCK as f32, |shortest, index| {
            let lengths = nodes[index].audio[1];
            self.with_node(index, 0, |_, unit, _, sources| {
                let Unit::Delay(line) = unit else { return shortest };
                sources.samples(lengths, 0, BLOCK).iter().fold(shortest.min(line.longest()), |shortest, &length| shortest.min(length))
            })
        });
        // Control inputs are still read every CONTROL samples, so a chunk never crosses one of those.
        // TS: const chunk = Math.min(Math.max(Math.trunc(shortest), 1), CONTROL)
        let chunk = (shortest as i32).clamp(1, CONTROL as i32) as usize;
        for start in (0..BLOCK).step_by(chunk) {
            let length = chunk.min(BLOCK - start);
            delays().for_each(|index| self.delay_read(index, start, length));
            rest().for_each(|index| self.run_unit(index, start, length, true));
            delays().for_each(|index| self.delay_write(index, start, length));
        }
    }
}
