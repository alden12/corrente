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
//!   4 Voice (signal, 0)      the voice's frequency, gate, velocity, note, seed, or its zone's sample,
//!                            root, start or end (voice section only)
//!   5 Shared (node, port)    a pre section node's output (voice and post sections)
//!   6 VoiceSum (channel, 0)  the voices summed (post section and track output)
//!   7 Input (channel, 0)     the track's audio input: 0 and 1 main, 2 and 3 sidechain
//!   8 Host (signal, 0)       the transport: tempo, beat, playing, beat length in seconds and samples
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
pub const KIND_SAMPLER: i32 = 1001;
pub const KIND_WAVETABLE: i32 = 1002;
/// The sampler's controls: sample slot, root note, start, end, loop.
pub const SAMPLER_CONTROLS: usize = 5;
/// The most audio inputs a node may have.
pub const MAX_PORTS: usize = 16;
/// The most outputs a node may have.
pub const MAX_OUTPUTS: usize = 8;
/// The most voices a track may have.
pub const MAX_VOICES: usize = 64;
/// The most sample zones a definition may have (format.ts's MAX_ZONES): each is a param no node reads.
pub const MAX_ZONES: usize = 128;
/// A track's output and its voice sum are stereo.
pub const CHANNELS: usize = 2;
/// A track's audio inputs: a stereo main input and a stereo sidechain.
pub const MAX_INPUTS: usize = 4;
/// Per-voice signals: the note's frequency, its gate, its velocity, its note number (MIDI, 60 is
/// middle C) and a seed (a random number from 0 to 1 drawn at each note on, for drift and variation).
/// Then the sample zone the note picked (INST-36.6), set by JS after the note on: its sample slot,
/// root note, start and end.
pub const VOICE_SIGNALS: usize = 9;
pub const SIGNAL_FREQ: usize = 0;
pub const SIGNAL_GATE: usize = 1;
pub const SIGNAL_VELOCITY: usize = 2;
pub const SIGNAL_NOTE: usize = 3;
pub const SIGNAL_SEED: usize = 4;
pub const SIGNAL_SAMPLE: usize = 5;
// The sampler reads these three through its controls rather than by name, so only the tests name
// them. `#[allow(dead_code)]` keeps them as the layout without a warning.
#[allow(dead_code)]
pub const SIGNAL_ROOT: usize = 6;
#[allow(dead_code)]
pub const SIGNAL_START: usize = 7;
#[allow(dead_code)]
pub const SIGNAL_END: usize = 8;
/// Host signals, the same for every track: the tempo (beats a minute), the beat (counted from where
/// the transport started, running on while it's stopped), whether it's playing (0 or 1), and how
/// long a beat is in seconds and in samples (so a delay syncs to the tempo without dividing), and the
/// sample rate (so a time in seconds becomes samples by scaling it).
pub const HOST_SIGNALS: usize = 6;
pub const HOST_TEMPO: usize = 0;
pub const HOST_BEAT: usize = 1;
pub const HOST_PLAYING: usize = 2;
pub const HOST_BEAT_SECONDS: usize = 3;
pub const HOST_BEAT_SAMPLES: usize = 4;
pub const HOST_SAMPLE_RATE: usize = 5;

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
//     | { type: "input"; channel: number }
//     | { type: "host"; signal: number };
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
    /// One of the host's signals.
    Host(usize),
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

// TS: type NodeKind = { type: "faust"; kind: number } | { type: "delay" } | { type: "sampler" } | { type: "wavetable" }
// `PartialEq` lets two kinds compare with ==, as a carried node's must (INST-36.7).
#[derive(PartialEq)]
pub enum NodeKind {
    Faust(usize),
    Delay,
    Sampler,
    Wavetable,
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

/// How the words name what an input reads, as (type, index, extra): words.ts writes these numbers.
/// A node in the same section, this block: (node, port).
pub const INPUT_BUFFER: i32 = 0;
/// A node in the same section, the sample before (a feedback edge): (node, port).
pub const INPUT_PREVIOUS: i32 = 1;
/// A param source: (index).
pub const INPUT_PARAM: i32 = 2;
/// A fixed number: (0, its f32 bits).
pub const INPUT_CONSTANT: i32 = 3;
/// A voice signal: (signal).
pub const INPUT_VOICE: i32 = 4;
/// A node in the pre section, read from a later one: (node, port).
pub const INPUT_SHARED: i32 = 5;
/// The voices summed: (channel).
pub const INPUT_VOICE_SUM: i32 = 6;
/// The track's audio input: (channel).
pub const INPUT_INPUT: i32 = 7;
/// A host signal: (signal).
pub const INPUT_HOST: i32 = 8;

/// How a step runs, as words.ts writes it: one node over the block, a loop a sample at a time, or a
/// loop in chunks cut by delays.
pub const STEP_NODE: i32 = 0;
pub const STEP_SAMPLE_LOOP: i32 = 1;
pub const STEP_CHUNK_LOOP: i32 = 2;

/// Why a plan was rejected: -1 for a bad node, step or source, -2 for words left over or missing.
pub const REJECTED: i32 = -1;
pub const WRONG_LENGTH: i32 = -2;

// TS: export function parse(words: Int32Array): Plan, throwing an error code
pub fn parse(words: &[i32]) -> Result<Plan, i32> {
    let mut reader = Reader { words, at: 0, constants: Vec::new() };
    let param_count = reader.count()?;
    let voice_count = reader.count()?;
    // Each param is read by an input of at least one word, or is a zone's sample (which the bank
    // reads, not a node), so there can't be more than that: a bigger count is a bad plan, turned away
    // before a track makes room for it.
    if voice_count > MAX_VOICES || param_count > words.len() + MAX_ZONES {
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
