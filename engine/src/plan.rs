//! Reading a plan: the flat int32 words the plan compiler writes (in TypeScript, INST-36.4), into
//! the sections, nodes and steps the router runs for one track.
//!
//! A plan has three sections, each a list of nodes and the steps that run them:
//! - **pre** runs once per block for the track, before the voices: an LFO all voices share, the mod
//!   wheel, pitch bend.
//! - **voice** runs once per block for each sounding voice. Its output, scaled by velocity, is summed
//!   across the voices into the track's voice sum.
//! - **post** runs once per block after the voices: effects on the voice sum, or, for a track with no
//!   voices (a return track, an effect), on the track's audio inputs.
//! The voice section may read the pre section's buffers, and the post section both the pre section's
//! and the voice sum; nothing reads backwards.
//!
//! Layout (a float is its bit pattern):
//!   header: paramCount, voiceCount
//!   each section, pre then voice then post: nodeCount, stepCount, then the nodes, then the steps
//!     each node: kind, audioCount, controlCount, then each input as (type, index, extra)
//!     each step: mode, memberCount, node ids
//!   voice output: channelCount (0 to 2), then each channel's source as (type, index, extra)
//!   track output: the same
//! One output channel plays in both left and right.
//!
//! Input types, as (type, index, extra):
//!   0 Buffer (node, port)    a node's output in the same section, this block
//!   1 Previous (node, port)  the same, a sample late: a feedback edge in a one-sample loop
//!   2 Param (param, 0)       a param of the track, ramped over each block
//!   3 Const (0, bits)        a literal
//!   4 Voice (signal, 0)      the voice's frequency, gate or velocity (voice section only)
//!   5 Shared (node, port)    a pre section node's output (voice and post sections)
//!   6 VoiceSum (channel, 0)  the voices summed (post section and track output)
//!   7 Input (channel, 0)     the track's audio input: 0 and 1 main, 2 and 3 sidechain
//!
//! Node i of a section writes its outputs into that section's buffers, from `base[i]` on. Every node
//! runs exactly once, and everything is checked here, so the router can index without failing.
//!
//! Rust notes, for reading this file:
//! - An `enum` here can carry data: `Source::Buffer(3, 0)` is "read node 3's first output". `match`
//!   takes it apart, and the compiler insists every variant is handled.
//! - `Result<Plan, i32>` is "a plan, or an error code". The `?` after a call returns the error early
//!   if there is one, like a thrown exception that the signature has to declare.
//! - `.map(...).collect::<Result<Vec<_>, _>>()?` turns a list of results into one result: all the
//!   values, or the first error.

use crate::faust;

// TS: export const KIND_DELAY = 1000; and so on. Rust constants need their type written.
/// Native kinds sit above the Faust ones.
pub const KIND_DELAY: i32 = 1000;
/// The most audio inputs a node may have.
pub const MAX_PORTS: usize = 16;
/// The most outputs a node may have.
pub const MAX_OUTPUTS: usize = 8;
/// The most voices a track may have.
pub const MAX_VOICES: usize = 64;
/// A track's output and its voice sum are stereo.
pub const CHANNELS: usize = 2;
/// A track's audio inputs: a stereo main input and a stereo sidechain.
pub const MAX_INPUTS: usize = 4;
/// Per-voice signals: the note's frequency, its gate and its velocity.
pub const VOICE_SIGNALS: usize = 3;
pub const SIGNAL_FREQ: usize = 0;
pub const SIGNAL_GATE: usize = 1;
pub const SIGNAL_VELOCITY: usize = 2;

/// Where one input reads from. (node, port) pairs name a node's output.
// TS:
//   type Source =
//     | { type: "buffer"; node: number; port: number }
//     | { type: "previous"; node: number; port: number }
//     | { type: "shared"; node: number; port: number }
//     | { type: "param"; param: number }
//     | { type: "const"; index: number }
//     | { type: "voice"; signal: number }
//     | { type: "voiceSum"; channel: number }
//     | { type: "input"; channel: number };
// A Rust enum is a discriminated union built in: each variant can carry its own data.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Source {
    /// A node's output in the same section, this block's samples.
    Buffer(usize, usize),
    /// The same, read a sample late: a feedback edge in a one-sample loop.
    Previous(usize, usize),
    /// A pre section node's output, read from the voice or post section.
    Shared(usize, usize),
    /// A track param, smoothed.
    Param(usize),
    /// A literal, as a buffer filled with it (an index into the plan's constants).
    Const(usize),
    /// One of the voice's signals.
    Voice(usize),
    /// A channel of the voices summed.
    VoiceSum(usize),
    /// A channel of the track's audio input.
    Input(usize),
}

// TS: methods on Source. `impl Source { ... }` adds methods to a type after declaring it.
impl Source {
    /// The node in the same section whose output this reads, if any.
    // TS: return source.type === "buffer" || source.type === "previous" ? source.node : undefined
    // `A(node, _) | B(node, _) =>` matches either variant and pulls out `node`, ignoring the port.
    pub fn node(self) -> Option<usize> {
        match self {
            Source::Buffer(node, _) | Source::Previous(node, _) => Some(node),
            _ => None,
        }
    }
}

// TS: type NodeKind = { type: "faust"; kind: number } | { type: "delay" }
pub enum NodeKind {
    Faust(usize),
    Delay,
}

// TS: interface Node { kind: NodeKind; audio: Source[]; control: Source[]; outputs: number; readsItself: boolean }
// A `struct` is a plain object type with named fields; `pub` makes a field readable outside this file.
pub struct Node {
    pub kind: NodeKind,
    pub audio: Vec<Source>,
    /// Control inputs, in the order the block declares its sliders.
    pub control: Vec<Source>,
    /// How many outputs it writes.
    pub outputs: usize,
    /// Whether it reads its own output (a one-sample feedback edge onto itself).
    pub reads_itself: bool,
}

impl Node {
    // TS: isDelay() { return this.kind.type === "delay" }
    // `matches!(value, Pattern)` is a one-line match that gives true or false.
    pub fn is_delay(&self) -> bool {
        matches!(self.kind, NodeKind::Delay)
    }

    // TS: inputs() { return [...this.audio, ...this.control] }, but lazily, without building a list.
    // `impl Iterator<Item = Source>` means "some iterator of Sources": the caller loops over it.
    // `'_` says the iterator borrows from `self`, so it can't outlive the node.
    fn inputs(&self) -> impl Iterator<Item = Source> + '_ {
        self.audio.iter().chain(&self.control).copied()
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

/// Which section a source is read from, for what it may read.
// TS: type Place = "pre" | "voice" | "post"
#[derive(Clone, Copy, PartialEq)]
enum Place {
    Pre,
    Voice,
    Post,
}

// TS: interface Section { nodes: Node[]; steps: Step[]; base: number[]; bufferCount: number }
pub struct Section {
    pub nodes: Vec<Node>,
    pub steps: Vec<Step>,
    /// Where each node's outputs start in the section's buffers.
    pub base: Vec<usize>,
    /// How many buffers the section needs: one per output of every node.
    pub buffer_count: usize,
}

// TS: interface Plan { paramCount: number; voiceCount: number; constants: number[]; pre: Section; voice: Section; post: Section; voiceOut: Source[]; trackOut: Source[] }
pub struct Plan {
    pub param_count: usize,
    pub voice_count: usize,
    /// The literal each `Source::Const` points at.
    pub constants: Vec<f32>,
    pub pre: Section,
    pub voice: Section,
    pub post: Section,
    /// Each voice's output channels, read in the voice section: empty, mono or stereo.
    pub voice_out: Vec<Source>,
    /// The track's output channels, read in the post section: empty, mono or stereo.
    pub track_out: Vec<Source>,
}

/// Why a plan was rejected: -1 for a bad node, step or source, -2 for words left over or missing.
pub const REJECTED: i32 = -1;
pub const WRONG_LENGTH: i32 = -2;

/// Reads words in order, collecting the plan's constants as it goes. Past the end it reads 0 and
/// counts the overrun, so the length check catches a plan cut short as well as one with words left
/// over.
// TS: class Reader { constructor(public words: Int32Array, public at = 0, public constants: number[] = []) {} }
// No TS equivalent for `<'a>`: a "lifetime", a name for how long the borrowed `words` lives. The
// struct holds a loan of the caller's array rather than a copy, and this tells the compiler a
// `Reader` can't outlive that array.
struct Reader<'a> {
    words: &'a [i32],
    at: usize,
    constants: Vec<f32>,
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
    fn count(&mut self) -> Result<usize, i32> {
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
    fn section(&mut self, place: Place, param_count: usize, pre: &[Node]) -> Result<Section, i32> {
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
    fn outputs(&mut self, place: Place, param_count: usize, own: &[Node], pre: &[Node]) -> Result<Vec<Source>, i32> {
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
    }
}

// TS: export function parse(words: Int32Array): Plan, throwing an error code
pub fn parse(words: &[i32]) -> Result<Plan, i32> {
    let mut reader = Reader { words, at: 0, constants: Vec::new() };
    let param_count = reader.count()?;
    let voice_count = reader.count()?;
    if voice_count > MAX_VOICES {
        return Err(REJECTED);
    }
    // The pre section reads no other section, so it is given an empty list as `pre`.
    let pre = reader.section(Place::Pre, param_count, &[])?;
    let voice = reader.section(Place::Voice, param_count, &pre.nodes)?;
    let post = reader.section(Place::Post, param_count, &pre.nodes)?;
    let voice_out = reader.outputs(Place::Voice, param_count, &voice.nodes, &pre.nodes)?;
    let track_out = reader.outputs(Place::Post, param_count, &post.nodes, &pre.nodes)?;
    if reader.at != words.len() {
        return Err(WRONG_LENGTH);
    }
    let constants = reader.constants;
    Ok(Plan { param_count, voice_count, constants, pre, voice, post, voice_out, track_out })
}

/// Whether every node runs exactly once, and reads only what has already been computed when it runs.
/// A plan that fails this would still play, just wrongly (a node reading last block's samples, or
/// zeros), so it is refused: a mistake in the plan compiler shows up as an error rather than as a
/// subtly wrong sound.
///
/// - A single node reads nodes from earlier steps.
/// - A one-sample loop's members may also read members earlier in the loop, and any member as a
///   feedback edge (the sample before).
/// - A loop cut by delays runs its delays first and writes their input last, so a delay may take its
///   input from any member, but its length must come from outside the loop. The other members read
///   earlier steps, the delays, and members before them.
// TS: function runsInOrder(nodes: Node[], steps: Step[]): boolean
fn runs_in_order(nodes: &[Node], steps: &[Step]) -> bool {
    // TS: const ready = new Array(nodes.length).fill(false)
    let mut ready = vec![false; nodes.len()];
    // TS: for (const step of steps)
    for step in steps {
        let members = &step.nodes;
        let in_step = |index: usize| members.contains(&index);
        let in_order = match step.mode {
            // TS: one member, and every input either isn't a node in this section or is a ready
            // node's output this block. `Source::Buffer(from, _) if ready[from]` matches a Buffer
            // and checks it in one go.
            StepMode::Node => {
                let node = &nodes[members[0]];
                members.len() == 1 && node.inputs().all(|source| matches!(source, Source::Buffer(from, _) if ready[from]) || source.node().is_none())
            }
            // TS: members.every((index, position) => nodes[index].inputs().every((source) => ...))
            // `members[..position]` is members.slice(0, position).
            StepMode::SampleLoop => members.iter().enumerate().all(|(position, &index)| {
                nodes[index].inputs().all(|source| match source {
                    Source::Buffer(from, _) => ready[from] || members[..position].contains(&from),
                    Source::Previous(from, _) => ready[from] || in_step(from),
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
                        Source::Buffer(from, _) => ready[from] || in_step(from),
                        Source::Previous(..) => false,
                        _ => true,
                    };
                    let length_ok = match node.audio[1] {
                        Source::Buffer(from, _) => ready[from],
                        Source::Previous(..) => false,
                        _ => true,
                    };
                    input_ok && length_ok
                });
                let rest_ok = rest.iter().enumerate().all(|(position, &index)| {
                    !nodes[index].is_delay()
                        && nodes[index].inputs().all(|source| match source {
                            Source::Buffer(from, _) => ready[from] || cut.contains(&from) || rest[..position].contains(&from),
                            Source::Previous(..) => false,
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
    // TS: return ready.every(Boolean). Every node ran, so the outputs and other sections can read any of them.
    ready.iter().all(|&ran| ran)
}
