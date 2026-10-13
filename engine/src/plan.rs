//! Reading a plan: the flat int32 words the plan compiler writes (in TypeScript, INST-36.4), into
//! the nodes and steps the router runs.
//!
//! Layout (a float is its bit pattern):
//!   header: nodeCount, paramCount, stepCount, outNode
//!   each node: kind, audioCount, controlCount, then each input as (type, index, value)
//!   each step: mode, nodeCount, node ids
//! Node i writes buffer i. Everything is checked here, so the router can index without failing.
//!
//! Rust notes, for reading this file:
//! - An `enum` here can carry data: `Source::Buffer(3)` is "read node 3's buffer". `match` takes it
//!   apart, and the compiler insists every variant is handled.
//! - `Result<Plan, i32>` is "a plan, or an error code". The `?` after a call returns the error early
//!   if there is one, like a thrown exception that the signature has to declare.
//! - `.map(...).collect::<Result<Vec<_>, _>>()?` turns a list of results into one result: all the
//!   values, or the first error.

// TS: import * as faust from "./faust". `crate::` means "from the root of this package".
use crate::faust;

// TS: export const KIND_DELAY = 1000; and so on. Rust constants need their type written.
/// Native kinds sit above the Faust ones.
pub const KIND_DELAY: i32 = 1000;
/// The most audio inputs a node may have.
pub const MAX_PORTS: usize = 16;
/// Per-voice signals: the note's frequency, its gate and its velocity.
pub const VOICE_SIGNALS: usize = 3;
pub const SIGNAL_FREQ: usize = 0;
pub const SIGNAL_GATE: usize = 1;
pub const SIGNAL_VELOCITY: usize = 2;

/// Where one input reads from.
// TS:
//   type Source =
//     | { type: "buffer"; node: number }
//     | { type: "previous"; node: number }
//     | { type: "param"; param: number }
//     | { type: "const"; index: number }
//     | { type: "voice"; signal: number };
// A Rust enum is a discriminated union built in: each variant can carry its own data.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Source {
    /// Another node's buffer, this block's samples.
    Buffer(usize),
    /// A node's buffer read a sample late: a feedback edge in a one-sample loop.
    Previous(usize),
    /// A shared, smoothed param.
    Param(usize),
    /// A literal, as a buffer filled with it (an index into the plan's constants).
    Const(usize),
    /// One of the voice's signals.
    Voice(usize),
}

// TS: methods on Source. `impl Source { ... }` adds methods to a type after declaring it, the way a
// TS class body would hold them. A method taking `self` (not `&self`) gets a copy, fine for a small
// Copy type.
impl Source {
    /// The node whose buffer this reads, if any.
    // TS: return source.type === "buffer" || source.type === "previous" ? source.node : undefined
    // `A(node) | B(node) =>` matches either variant and pulls out `node` from whichever it is.
    pub fn node(self) -> Option<usize> {
        match self {
            Source::Buffer(node) | Source::Previous(node) => Some(node),
            _ => None,
        }
    }
}

// TS: type NodeKind = { type: "faust"; kind: number } | { type: "delay" }
pub enum NodeKind {
    Faust(usize),
    Delay,
}

// TS: interface Node { kind: NodeKind; audio: Source[]; control: Source[]; readsItself: boolean }
// A `struct` is a plain object type with named fields; `pub` on a field makes it readable outside
// this file.
pub struct Node {
    pub kind: NodeKind,
    pub audio: Vec<Source>,
    /// Control inputs, in the order the block declares its sliders.
    pub control: Vec<Source>,
    /// Whether it reads its own buffer (a one-sample feedback edge onto itself).
    pub reads_itself: bool,
}

impl Node {
    // TS: isDelay() { return this.kind.type === "delay" }
    // `matches!(value, Pattern)` is a one-line match that gives true or false.
    pub fn is_delay(&self) -> bool {
        matches!(self.kind, NodeKind::Delay)
    }
}

// TS: type StepMode = "node" | "sampleLoop" | "chunkLoop". Variants with no data are like a string union.
#[derive(Clone, Copy, PartialEq)]
pub enum StepMode {
    /// One node over the whole block.
    Node,
    /// A feedback loop run one sample at a time.
    SampleLoop,
    /// A loop cut by delays, run in chunks no longer than its shortest delay.
    ChunkLoop,
}

// TS: interface Step { mode: StepMode; nodes: number[] }
pub struct Step {
    pub mode: StepMode,
    pub nodes: Vec<usize>,
}

// TS: interface Plan { nodes: Node[]; steps: Step[]; paramCount: number; constants: number[]; out?: number }
pub struct Plan {
    pub nodes: Vec<Node>,
    pub steps: Vec<Step>,
    pub param_count: usize,
    /// The literal each `Source::Const` points at.
    pub constants: Vec<f32>,
    /// The node whose buffer is the voice's output, if any.
    pub out: Option<usize>,
}

/// Why a plan was rejected: -1 for a bad node or step, -2 for words left over or missing.
pub const REJECTED: i32 = -1;
pub const WRONG_LENGTH: i32 = -2;

/// Reads words in order. Past the end it reads 0 and counts the overrun, so the length check
/// catches a plan cut short as well as one with words left over.
// TS: class Words { constructor(public words: Int32Array, public at = 0) {} }
// No TS equivalent for `<'a>`: a "lifetime", a name for how long the borrowed `words` lives. The
// struct holds a loan of the caller's array rather than a copy, and this tells the compiler a
// `Words` can't outlive that array.
struct Words<'a> {
    words: &'a [i32],
    at: usize,
}

// `'_` is "whatever the lifetime is": these methods don't care.
impl Words<'_> {
    // TS: next(): number { return this.words[this.at++] ?? 0 }
    fn next(&mut self) -> i32 {
        let word = self.words.get(self.at).copied().unwrap_or(0);
        self.at += 1;
        word
    }

    // TS: count(): number { const word = this.next(); if (word < 0) throw REJECTED; return word }
    // `.map_err(f)` swaps the error for f(error), here always REJECTED; `|_|` ignores the original.
    fn count(&mut self) -> Result<usize, i32> {
        usize::try_from(self.next()).map_err(|_| REJECTED)
    }
}

// TS: export function parse(words: Int32Array): Plan, throwing an error code
pub fn parse(words: &[i32]) -> Result<Plan, i32> {
    // TS: const reader = new Words(words). Rust lets a new variable reuse a name ("shadowing"):
    // from here on `words` means the reader.
    let mut words = Words { words, at: 0 };
    let node_count = words.count()?;
    let param_count = words.count()?;
    let step_count = words.count()?;
    // TS: const out = outWord >= 0 ? outWord : undefined
    let out = usize::try_from(words.next()).ok();
    let mut constants = Vec::new();

    // TS: const readInput = (words: Words): Source => { ... }, throwing REJECTED.
    // The closure pushes into `constants`, so it borrows it writable, and must itself be `mut`.
    // `f32::from_bits(word as u32)` reads the word's bits as a float, like
    // `new Float32Array(new Int32Array([word]).buffer)[0]`.
    let mut read_input = |words: &mut Words| -> Result<Source, i32> {
        let kind = words.next();
        let index = words.next();
        let value = f32::from_bits(words.next() as u32);
        let index = usize::try_from(index).map_err(|_| REJECTED)?;
        // TS: switch (kind) { case 0: ...; default: throw REJECTED }. A `match` gives a value, and a
        // `{ ... }` block's last expression is its value, so case 3 pushes and then yields the Source.
        let source = match kind {
            0 => Source::Buffer(index),
            1 => Source::Previous(index),
            2 => Source::Param(index),
            3 => {
                constants.push(value);
                Source::Const(constants.len() - 1)
            }
            4 => Source::Voice(index),
            _ => return Err(REJECTED),
        };
        // TS: const inRange = source.type === "buffer" || ... ? source.node < nodeCount : ...
        let in_range = match source {
            Source::Buffer(node) | Source::Previous(node) => node < node_count,
            Source::Param(param) => param < param_count,
            Source::Voice(signal) => signal < VOICE_SIGNALS,
            Source::Const(_) => true,
        };
        if in_range { Ok(source) } else { Err(REJECTED) }
    };

    // TS: const nodes = Array.from({ length: nodeCount }, () => { ... return node }), any throw
    // stopping the lot. `return Err(...)` inside the closure returns from the closure, and the
    // `collect::<Result<...>>()?` after it passes the first error on out of `parse`.
    let nodes = (0..node_count)
        .map(|_| {
            let kind = words.next();
            let audio_count = words.count()?;
            let control_count = words.count()?;
            let audio = (0..audio_count).map(|_| read_input(&mut words)).collect::<Result<Vec<_>, _>>()?;
            let control = (0..control_count).map(|_| read_input(&mut words)).collect::<Result<Vec<_>, _>>()?;
            // `KIND_DELAY if ...` matches that value with an extra condition. `faust if ...` matches
            // any value, naming it `faust`, again with a condition.
            let kind = match kind {
                KIND_DELAY if audio.len() == 2 => NodeKind::Delay,
                // A Faust block's compute needs exactly as many inputs as it declares.
                faust if faust::inputs(faust) == Some(audio.len()) => NodeKind::Faust(faust as usize),
                _ => return Err(REJECTED),
            };
            if audio.len() > MAX_PORTS {
                return Err(REJECTED);
            }
            // TS: return { kind, audio, control, readsItself: false }. Fields named like the
            // variables holding them can be written once, as in TS.
            Ok(Node { kind, audio, control, reads_itself: false })
        })
        .collect::<Result<Vec<Node>, _>>()?;
    // TS: const withSelf = nodes.map((node, index) => ({ ...node, readsItself: [...node.audio, ...node.control].some(...) }))
    // `.into_iter()` consumes `nodes` (moving each node out, no copying); `.enumerate()` pairs each
    // with its index. `..node` is the spread: the rest of the fields from `node`.
    let nodes = nodes
        .into_iter()
        .enumerate()
        .map(|(index, node)| {
            let reads_itself = node.audio.iter().chain(&node.control).any(|source| source.node() == Some(index));
            Node { reads_itself, ..node }
        })
        .collect::<Vec<Node>>();

    // TS: const steps = Array.from({ length: stepCount }, () => { ... }), as for the nodes.
    let steps = (0..step_count)
        .map(|_| {
            let mode = match words.next() {
                0 => StepMode::Node,
                1 => StepMode::SampleLoop,
                2 => StepMode::ChunkLoop,
                _ => return Err(REJECTED),
            };
            let count = words.count()?;
            // TS: each word, if it's a node that exists, else throw REJECTED.
            // `.filter(f)` on an Option keeps the value only if f says so; `|&node|` copies the
            // number out of the reference it's given. `.ok_or(e)` turns None into Err(e).
            let members = (0..count)
                .map(|_| usize::try_from(words.next()).ok().filter(|&node| node < node_count).ok_or(REJECTED))
                .collect::<Result<Vec<_>, _>>()?;
            if members.is_empty() {
                return Err(REJECTED);
            }
            Ok(Step { mode, nodes: members })
        })
        .collect::<Result<Vec<_>, _>>()?;

    // TS: if (out !== undefined && out >= nodeCount) throw REJECTED
    if out.is_some_and(|node| node >= node_count) {
        return Err(REJECTED);
    }
    if !runs_in_order(&nodes, &steps, out) {
        return Err(REJECTED);
    }
    if words.at != words.words.len() {
        return Err(WRONG_LENGTH);
    }
    Ok(Plan { nodes, steps, param_count, constants, out })
}

/// Whether every node reads only what has already been computed when it runs. A plan that fails this
/// would still play, just wrongly (a node reading last block's samples, or zeros), so it is refused:
/// a mistake in the plan compiler shows up as an error rather than as a subtly wrong sound.
///
/// - A single node reads nodes from earlier steps.
/// - A one-sample loop's members may also read members earlier in the loop, and any member as a
///   feedback edge (the sample before).
/// - A loop cut by delays runs its delays first and writes their input last, so a delay may take its
///   input from any member, but its length must come from outside the loop. The other members read
///   earlier steps, the delays, and members before them.
/// - The output node must have run.
// TS: function runsInOrder(nodes: Node[], steps: Step[], out?: number): boolean
fn runs_in_order(nodes: &[Node], steps: &[Step], out: Option<usize>) -> bool {
    // TS: const ready = new Array(nodes.length).fill(false)
    let mut ready = vec![false; nodes.len()];
    // TS: const reads = (node: Node) => [...node.audio, ...node.control]
    // `.chain(...)` joins two iterators; `.copied()` copies each Source out of its reference.
    let reads = |node: &Node| node.audio.iter().chain(&node.control).copied().collect::<Vec<Source>>();
    // TS: for (const step of steps)
    for step in steps {
        let members = &step.nodes;
        let in_step = |index: usize| members.contains(&index);
        let in_order = match step.mode {
            // TS: one member, and every input either isn't a node or is a ready node's buffer.
            // `Source::Buffer(from) if ready[*from]` matches a Buffer and checks it in one go; `*from`
            // reads the number through the reference `matches!` hands out.
            StepMode::Node => {
                let node = &nodes[members[0]];
                members.len() == 1 && reads(node).iter().all(|source| matches!(source, Source::Buffer(from) if ready[*from]) || source.node().is_none())
            }
            // TS: members.every((index, position) => reads(nodes[index]).every((source) => ...))
            // `members[..position]` is members.slice(0, position).
            StepMode::SampleLoop => members.iter().enumerate().all(|(position, &index)| {
                reads(&nodes[index]).iter().all(|&source| match source {
                    Source::Buffer(from) => ready[from] || members[..position].contains(&from),
                    Source::Previous(from) => ready[from] || in_step(from),
                    _ => true,
                })
            }),
            StepMode::ChunkLoop => {
                // TS: how many members at the start are delays, then
                //   const [cut, rest] = [members.slice(0, delays), members.slice(delays)]
                // `&&index` unwraps two layers of reference to get the number. `split_at` gives two
                // views into the same list rather than copies.
                let delays = members.iter().take_while(|&&index| nodes[index].is_delay()).count();
                let (cut, rest) = members.split_at(delays);
                let delays_ok = cut.iter().all(|&index| {
                    let node = &nodes[index];
                    let input_ok = match node.audio[0] {
                        Source::Buffer(from) => ready[from] || in_step(from),
                        Source::Previous(_) => false,
                        _ => true,
                    };
                    let length_ok = match node.audio[1] {
                        Source::Buffer(from) => ready[from],
                        Source::Previous(_) => false,
                        _ => true,
                    };
                    input_ok && length_ok
                });
                let rest_ok = rest.iter().enumerate().all(|(position, &index)| {
                    !nodes[index].is_delay()
                        && reads(&nodes[index]).iter().all(|&source| match source {
                            Source::Buffer(from) => ready[from] || cut.contains(&from) || rest[..position].contains(&from),
                            Source::Previous(_) => false,
                            _ => true,
                        })
                });
                !cut.is_empty() && delays_ok && rest_ok
            }
        };
        // A node in two steps, or out of order: refuse.
        if !in_order || members.iter().any(|&index| ready[index]) {
            return false;
        }
        // TS: members.forEach((index) => (ready[index] = true))
        members.iter().for_each(|&index| ready[index] = true);
    }
    // TS: return out === undefined || ready[out]
    out.is_none_or(|node| ready[node])
}
