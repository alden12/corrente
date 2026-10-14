//! Reading a plan's words into sections, checking each source against the section it is read in.

use super::order::runs_in_order;
use super::{CHANNELS, HOST_SIGNALS, KIND_DELAY, KIND_SAMPLER, SAMPLER_CONTROLS, MAX_INPUTS, MAX_OUTPUTS, MAX_PORTS, Node, NodeKind, Place, REJECTED, Section, Source, Step, StepMode, VOICE_SIGNALS};
use crate::faust;

/// Reads words in order, collecting the plan's constants as it goes. Past the end it reads 0 and
/// counts the overrun, so the length check catches a plan cut short as well as one with words left
/// over.
// No TS equivalent for `<'a>`: a "lifetime", a name for how long the borrowed `words` lives. The
// struct holds a loan of the caller's array rather than a copy, and this tells the compiler a
// `Reader` can't outlive that array.
pub(super) struct Reader<'a> {
    pub(super) words: &'a [i32],
    pub(super) at: usize,
    pub(super) constants: Vec<f32>,
}

// `'_` is "whatever the lifetime is": these methods don't care.
impl Reader<'_> {
    // TS: next(): number { return this.words[this.at++] ?? 0 }
    fn next(&mut self) -> i32 {
        let word = self.words.get(self.at).copied().unwrap_or(0);
        self.at += 1;
        word
    }

    // TS: count(): number { const word = this.next(); if (word < 0) throw REJECTED; return word }
    // `.map_err(f)` swaps the error for f(error), here always REJECTED; `|_|` ignores the original.
    pub(super) fn count(&mut self) -> Result<usize, i32> {
        usize::try_from(self.next()).map_err(|_| REJECTED)
    }

    // TS: n of something read one after another, as a list, stopping at the first throw.
    // `impl FnMut(&mut Self) -> Result<T, i32>` is a function argument that may be called many times
    // and may change what it captured; here it reads from this reader.
    fn list<T>(&mut self, count: usize, mut read: impl FnMut(&mut Self) -> Result<T, i32>) -> Result<Vec<T>, i32> {
        (0..count).map(|_| read(self)).collect()
    }

    /// One input as written, before it is checked against the section it is in.
    // TS: switch (type) { case 0: return { type: "buffer", node: index, port: extra }; ... default: throw REJECTED }
    // A `match` gives a value, and a `{ ... }` block's last expression is its value, so case 3
    // pushes the constant and then yields the Source. `f32::from_bits(word as u32)` reads the word's
    // bits as a float, like `new Float32Array(new Int32Array([word]).buffer)[0]`.
    fn input(&mut self) -> Result<Source, i32> {
        let kind = self.next();
        let index = usize::try_from(self.next()).map_err(|_| REJECTED)?;
        let extra = self.next();
        let port = || usize::try_from(extra).map_err(|_| REJECTED);
        Ok(match kind {
            0 => Source::Buffer(index, port()?),
            1 => Source::Previous(index, port()?),
            2 => Source::Param(index),
            3 => {
                self.constants.push(f32::from_bits(extra as u32));
                Source::Const(self.constants.len() - 1)
            }
            4 => Source::Voice(index),
            5 => Source::Shared(index, port()?),
            6 => Source::VoiceSum(index),
            7 => Source::Input(index),
            8 => Source::Host(index),
            _ => return Err(REJECTED),
        })
    }

    // TS: readNode(): Node, throwing REJECTED for a kind that doesn't exist or the wrong input count.
    fn node(&mut self) -> Result<Node, i32> {
        let kind = self.next();
        let audio_count = self.count()?;
        let control_count = self.count()?;
        let audio = self.list(audio_count, Self::input)?;
        let control = self.list(control_count, Self::input)?;
        // `KIND_DELAY if ...` matches that value with an extra condition. `faust if ...` matches any
        // value, naming it `faust`, again with a condition. The match gives back a pair, which `let
        // (kind, outputs) =` takes apart.
        let (kind, outputs) = match kind {
            KIND_DELAY if audio.len() == 2 => (NodeKind::Delay, 1),
            // Frequency and gate in, every control given, left and right out.
            KIND_SAMPLER if audio.len() == 2 && control.len() == SAMPLER_CONTROLS => (NodeKind::Sampler, 2),
            // A Faust block's compute needs exactly as many inputs as it declares.
            faust if faust::inputs(faust) == Some(audio.len()) => (NodeKind::Faust(faust as usize), faust::outputs(faust).unwrap_or(0)),
            _ => return Err(REJECTED),
        };
        if audio.len() > MAX_PORTS || outputs > MAX_OUTPUTS {
            return Err(REJECTED);
        }
        Ok(Node { kind, audio, control, outputs, reads_itself: false })
    }

    // TS: readStep(nodeCount): Step
    // `.filter(f)` on an Option keeps the value only if f says so; `|&node|` copies the number out
    // of the reference it's given. `.ok_or(e)` turns None into Err(e).
    fn step(&mut self, node_count: usize) -> Result<Step, i32> {
        let mode = match self.next() {
            0 => StepMode::Node,
            1 => StepMode::SampleLoop,
            2 => StepMode::ChunkLoop,
            _ => return Err(REJECTED),
        };
        let count = self.count()?;
        let nodes = self.list(count, |reader| usize::try_from(reader.next()).ok().filter(|&node| node < node_count).ok_or(REJECTED))?;
        if nodes.is_empty() {
            return Err(REJECTED);
        }
        Ok(Step { mode, nodes })
    }

    /// A section, checked: every source is one this place may read, and every node runs once, in order.
    pub(super) fn section(&mut self, place: Place, param_count: usize, pre: &[Node]) -> Result<Section, i32> {
        let node_count = self.count()?;
        let step_count = self.count()?;
        let nodes = self.list(node_count, Self::node)?;
        let steps = self.list(step_count, |reader| reader.step(node_count))?;
        let readable = nodes.iter().all(|node| node.inputs().all(|source| may_read(source, place, &nodes, pre, param_count)));
        if !readable || !runs_in_order(&nodes, &steps) {
            return Err(REJECTED);
        }
        // TS: const marked = nodes.map((node, index) => ({ ...node, readsItself: node.inputs().some((source) => source.node === index) }))
        // `.into_iter()` consumes `nodes` (moving each node out, no copying); `.enumerate()` pairs
        // each with its index. `..node` is the spread: the rest of the fields from `node`.
        let nodes = nodes
            .into_iter()
            .enumerate()
            .map(|(index, node)| {
                // Worked out on its own line first: `..node` moves the node's fields into the new one,
                // so nothing may still be borrowing `node` (as `node.inputs()` would) at that point.
                let reads_itself = node.inputs().any(|source| source.node() == Some(index));
                Node { reads_itself, ..node }
            })
            .collect::<Vec<Node>>();
        // TS: let total = 0; const base = nodes.map((node) => { const start = total; total += node.outputs; return start; });
        // `scan` is a map that carries a running value (`total`) from one item to the next.
        let base = nodes
            .iter()
            .scan(0, |total, node| {
                let start = *total;
                *total += node.outputs;
                Some(start)
            })
            .collect::<Vec<usize>>();
        let buffer_count = nodes.iter().map(|node| node.outputs).sum();
        Ok(Section { nodes, steps, base, buffer_count })
    }

    /// A voice or track output: up to two sources, read where the section `place` is, never a sample late.
    pub(super) fn outputs(&mut self, place: Place, param_count: usize, own: &[Node], pre: &[Node]) -> Result<Vec<Source>, i32> {
        let count = self.count()?;
        if count > CHANNELS {
            return Err(REJECTED);
        }
        let sources = self.list(count, Self::input)?;
        let readable = sources.iter().all(|&source| !matches!(source, Source::Previous(..)) && may_read(source, place, own, pre, param_count));
        if readable { Ok(sources) } else { Err(REJECTED) }
    }
}

/// Whether a source may be read in this place: it names something that exists, and something the
/// section can see (a voice's signals only in the voice section, the voice sum only after it).
// TS:
//   const hasOutput = (nodes: Node[], node: number, port: number) => port < (nodes[node]?.outputs ?? 0);
//   switch (source.type) { case "buffer": case "previous": return hasOutput(own, source.node, source.port); ... }
// `nodes.get(node)` is a safe index, None past the end; `.is_some_and(f)` is `x !== undefined && f(x)`.
fn may_read(source: Source, place: Place, own: &[Node], pre: &[Node], param_count: usize) -> bool {
    let has_output = |nodes: &[Node], node: usize, port: usize| nodes.get(node).is_some_and(|node| port < node.outputs);
    match source {
        Source::Buffer(node, port) | Source::Previous(node, port) => has_output(own, node, port),
        Source::Shared(node, port) => place != Place::Pre && has_output(pre, node, port),
        Source::Param(param) => param < param_count,
        Source::Const(_) => true,
        Source::Voice(signal) => place == Place::Voice && signal < VOICE_SIGNALS,
        Source::VoiceSum(channel) => place == Place::Post && channel < CHANNELS,
        Source::Input(channel) => channel < MAX_INPUTS,
        Source::Host(signal) => signal < HOST_SIGNALS,
    }
}
