//! MIDI devices in the engine (INST-11.1, docs/app/MIDI-DEVICES.md): a track's chain of MIDI devices,
//! each a small graph of event nodes, between the keys it's told and its voices. The same Rust in the
//! app's worklet, the plugin and an export, so a device plays the same notes in all three.
//!
//! - **A chain** is what `eng_midi_load` hands a track (words.rs): its devices in order, and the
//!   values their fields read. Each device's output feeds the next; the last one's, the voices.
//! - **A device** is nodes in an order where every node comes after what it reads. Each block, every
//!   node turns its inputs' events into its own, in sample order (nodes.rs, clock.rs).
//! - **Events** are notes and ticks, each at a sample offset into the block. A note may carry a
//!   length (a step of an arpeggio): the chain lets it go itself, that many samples on, even in a
//!   later block.
//! - **Fields** are a number, a value through its shaping (a param), or a random number between two,
//!   drawn the same way every time (seeded by the step or the note), so an export comes out the same.
//!
//! Nothing allocates while playing: every list is made with room when the chain loads, and a list that
//! is full drops what doesn't fit rather than growing.
//!
//! Rust notes, for reading this folder:
//! - `engine/src/midi/mod.rs` is the module `midi`; `mod chain;` below makes `chain.rs` part of it.
//! - `#[derive(Clone, Copy, Debug, PartialEq)]` lets an Event be copied like a number, printed in a
//!   failing test, and compared with `==`.

mod chain;
mod clock;
mod nodes;
mod words;

pub use chain::Chain;
pub use words::parse;

use crate::router::Shaping;

/// The most events a node's output, or a chain's, holds in a block.
pub const MAX_EVENTS: usize = 256;
/// The most notes a node holds down at once (an arpeggiator's chord), and copies a stack makes.
pub const MAX_HELD: usize = 32;
pub const MAX_COPIES: usize = 8;
/// The most notes waiting to be let go (each step of an arpeggio, until its length runs out).
pub const MAX_RELEASES: usize = 256;

/// One thing a node passes on.
// TS:
//   type Event =
//     | { kind: "on"; note: number; velocity: number; length?: number }  // length in samples
//     | { kind: "off"; note: number }
//     | { kind: "tick"; step: number; samples: number };  // a clock's step, and a step's length
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    On { note: i32, velocity: f32, length: Option<u32> },
    Off { note: i32 },
    Tick { step: i64, samples: f64 },
}

/// An event `offset` samples into the block.
// TS: type Timed = [offset: number, event: Event]
pub type Timed = (usize, Event);

/// Where the transport is at the start of a block: its beat, beats a sample, and whether it's playing.
// TS: interface BlockTransport { beat: number; perSample: number; playing: boolean }
#[derive(Clone, Copy)]
pub struct BlockTransport {
    pub beat: f64,
    pub per_sample: f64,
    pub playing: bool,
}

/// What a field reads: a number, a value through its shaping, or a random number from `min` to `max`.
// TS: type Field = { fixed: number } | { value: number; shaping: Shaping } | { random: [min: number, max: number] }
pub enum Field {
    Fixed(f64),
    Bound(usize, Shaping),
    Random(f64, f64),
}

impl Field {
    /// The field's number now: `values` are the chain's, and `draw` the random number (0 to 1) for
    /// this step or note, asked for only by a random field.
    // TS: field.fixed ?? (field.value !== undefined ? resolveNumber(values[field.value], field.shaping) : min + draw() * (max - min))
    pub fn read(&self, values: &[f64], draw: impl FnOnce() -> f64) -> f64 {
        match self {
            Field::Fixed(value) => *value,
            Field::Bound(value, shaping) => shaping.resolve(values[*value]),
            Field::Random(min, max) => min + draw() * (max - min),
        }
    }
}

/// A random number from 0 to 1, the same every time for the same four numbers: what a random field
/// draws, from its device's seed, its node, and the step or note it's for.
// TS: splitmix64 over the words, then the top 53 bits as a fraction.
// `wrapping_mul` and `wrapping_add` let the arithmetic overflow round, as the hash wants (a plain `*`
// would stop a debug build). `^` is xor and `>>` a shift, as in TS.
pub fn draw(seed: u64, node: usize, field: usize, at: i64) -> f64 {
    let mut hash = seed ^ (node as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (field as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F) ^ at as u64;
    hash = (hash ^ (hash >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    hash = (hash ^ (hash >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    hash ^= hash >> 31;
    (hash >> 11) as f64 / (1u64 << 53) as f64
}
