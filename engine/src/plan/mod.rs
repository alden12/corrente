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
//!   header: paramCount, voiceCount, latency (samples the track's output runs late, for the mixer
//!     to make up: a look-ahead limiter's look-ahead, say)
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
//! The files: this one holds the plan's types and `parse`; reader.rs reads the words, and order.rs
//! checks every node runs once, in an order that works.
//!
//! Rust notes, for reading this folder:
//! - An `enum` here can carry data: `Source::Buffer(3, 0)` is "read node 3's first output". `match`
//!   takes it apart, and the compiler insists every variant is handled.
//! - `Result<Plan, i32>` is "a plan, or an error code". The `?` after a call returns the error early
//!   if there is one, like a thrown exception that the signature has to declare.
//! - `.map(...).collect::<Result<Vec<_>, _>>()?` turns a list of results into one result: all the
//!   values, or the first error.

mod order;
mod reader;

use reader::Reader;

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

pub struct Section {
    pub nodes: Vec<Node>,
    pub steps: Vec<Step>,
    /// Where each node's outputs start in the section's buffers.
    pub base: Vec<usize>,
    /// How many buffers the section needs: one per output of every node.
    pub buffer_count: usize,
}

pub struct Plan {
    pub param_count: usize,
    pub voice_count: usize,
    /// How many samples late the track's output is, for the mixer to compensate.
    pub latency: usize,
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

// TS: export function parse(words: Int32Array): Plan, throwing an error code
pub fn parse(words: &[i32]) -> Result<Plan, i32> {
    let mut reader = Reader { words, at: 0, constants: Vec::new() };
    let param_count = reader.count()?;
    let voice_count = reader.count()?;
    let latency = reader.count()?;
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
    Ok(Plan { param_count, voice_count, latency, constants, pre, voice, post, voice_out, track_out })
}
