//! MIDI devices in the engine (INST-11.1): a track's chain of MIDI devices,
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
//! - **Fields** are a number, a value through its shaping (a param), a random number between two,
//!   drawn the same way every time (seeded by the step or the note), so an export comes out the same,
//!   or something read off each note (its index, pitch or velocity) times one number plus another.
//! - **A note's index** is its place among notes made together: a stack's copies, or a chord `order`
//!   numbered. Its note off carries the same index, so a node can tell copies of one pitch apart.
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
mod pitch;
mod rhythm;
mod time;
mod words;

pub use chain::Chain;
#[cfg(test)]
pub use rhythm::pattern;
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
//     | { kind: "on"; note: number; velocity: number; length?: number; index: number }  // length in samples
//     | { kind: "off"; note: number; index: number }
//     | { kind: "tick"; step: number; samples: number; level: number };  // a clock's step, a step's length, and how loud (an accent)
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    On { note: i32, velocity: f32, length: Option<u32>, index: u8 },
    Off { note: i32, index: u8 },
    Tick { step: i64, samples: f64, level: f32 },
}

/// An event `offset` samples into the block.
// TS: type Timed = [offset: number, event: Event]
pub type Timed = (usize, Event);

/// Where the transport is at the start of a block: its beat, beats a sample, whether it's playing, and
/// the song's key.
// TS: interface BlockTransport { beat: number; perSample: number; playing: boolean; key: Key }
#[derive(Clone, Copy)]
pub struct BlockTransport {
    pub beat: f64,
    pub per_sample: f64,
    pub playing: bool,
    pub key: Key,
}

/// The song's key (DAW-12): its tonic's pitch class (0 = C), and its scale as bits, bit n set when the
/// note n semitones above the tonic is in it (theory/key.ts's scaleMask).
// TS: interface Key { tonic: number; scale: number }
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Key {
    pub tonic: u8,
    pub scale: u16,
}

impl Key {
    /// C major: C, D, E, F, G, A, B. What a song plays in until it's given a key.
    // TS: const C_MAJOR = { tonic: 0, scale: scaleMask("major") }
    pub const C_MAJOR: Key = Key { tonic: 0, scale: 0b1010_1011_0101 };
}

/// What a field reads: a number, a value through its shaping, a random number from `min` to `max`, or
/// something about the note it's read for, times a field plus a field (each a number or a value).
// TS: type Field = { fixed: number } | { value: number; shaping: Shaping } | { random: [min: number, max: number] } | { per: Per; times: Field; plus: Field }
// `Box<Field>` keeps a field inside a field: it's made when the chain loads, never while playing.
pub enum Field {
    Fixed(f64),
    Bound(usize, Shaping),
    Random(f64, f64),
    Per(Per, Box<Field>, Box<Field>),
}

/// What a per-note field reads off the note.
// TS: type Per = "index" | "pitch" | "velocity"
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Per {
    Index,
    Pitch,
    Velocity,
}

/// The note a field is read for: none (a step's field) reads as all zeros.
// TS: interface NoteContext { index: number; pitch: number; velocity: number }
#[derive(Clone, Copy, Default)]
pub struct NoteContext {
    pub index: u8,
    pub pitch: i32,
    pub velocity: f32,
}

impl NoteContext {
    /// The note an event is, if it's a note.
    // TS: event.kind === "tick" ? {} : { index: event.index, pitch: event.note, velocity: event.velocity ?? 0 }
    pub fn of(event: Event) -> Self {
        match event {
            Event::On { note, velocity, index, .. } => NoteContext { index, pitch: note, velocity },
            Event::Off { note, index } => NoteContext { index, pitch: note, velocity: 0.0 },
            Event::Tick { .. } => NoteContext::default(),
        }
    }
}

impl Field {
    /// The field's number now: `values` are the chain's, `draw` the random number (0 to 1) for this
    /// step or note, asked for only by a random field, and `note` what a per-note field reads.
    // TS: field.fixed ?? (field.value !== undefined ? resolveNumber(...) : field.random ? min + draw() * (max - min) : per(note) * times + plus)
    pub fn read(&self, values: &[f64], draw: impl FnOnce() -> f64, note: NoteContext) -> f64 {
        match self {
            Field::Fixed(value) => *value,
            Field::Bound(value, shaping) => shaping.resolve(values[*value]),
            Field::Random(min, max) => min + draw() * (max - min),
            Field::Per(per, times, plus) => {
                // TS: const read = { index: note.index, pitch: note.pitch, velocity: note.velocity }[per]
                let read = match per {
                    Per::Index => f64::from(note.index),
                    Per::Pitch => f64::from(note.pitch),
                    Per::Velocity => f64::from(note.velocity),
                };
                read * times.plain(values) + plus.plain(values)
            }
        }
    }

    /// A per-note field's own fields, which are only ever numbers or values (words.rs).
    // TS: field.fixed ?? resolveNumber(values[field.value], field.shaping)
    // Its own function, not `read`: `read` calling itself with a new closure each time would ask the
    // compiler for a new copy of it each time, without end.
    fn plain(&self, values: &[f64]) -> f64 {
        match self {
            Field::Fixed(value) => *value,
            Field::Bound(value, shaping) => shaping.resolve(values[*value]),
            Field::Random(..) | Field::Per(..) => 0.0,
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
