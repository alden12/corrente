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
//!   the loop. **So are the sampler and the wavetable**: they read samples the bank holds, which Faust's
//!   Rust backend can't.
//!
//! Every buffer is a `Slot` of 129 floats: slot 0 holds the last sample of the previous block,
//! 1..=128 the current one, so a feedback edge reads "the sample before" by offset, even at sample 0.
//! A node with several outputs writes several buffers, one after another.
//!
//! Voices are slots, each with its own copy of every voice-section block and its own buffers.
//! Allocation and stealing are decided in JS: the engine is told which slot plays what.
//!
//! The files, from the outside in:
//! - engine.rs: the bank, and everything lib.rs calls.
//! - track.rs: one track's block: params, the pre section, the voices, the post section.
//! - render.rs: running one section's steps over its nodes.
//! - sources.rs: what a node reads while it runs.
//! - delay.rs: the native delay line, and its steps.
//! - sampler.rs: the native sample player, and the samples a bank holds.
//! - wavetable.rs: the native wavetable oscillator, reading tables from the same slots.
//!
//! Rust notes, for reading this folder:
//! - A folder of modules: `router/mod.rs` is the module `router`, and each `mod track;` below makes
//!   `router/track.rs` a module inside it.
//! - `pub(super)` makes something visible to the parent module, here `router`, and so to every file
//!   in this folder, but not to the rest of the engine. Plain `pub` would let lib.rs see it too.
//!   Things declared in this file without `pub` are still visible to the files in the folder: a
//!   module sees everything in the modules that contain it.
//! - One type's methods can be spread over several `impl` blocks in different files: `Render` has
//!   most of its methods in render.rs and the delay's in delay.rs.

mod delay;
mod engine;
mod render;
mod sampler;
mod sources;
mod wavetable;
mod track;

// TS: export { Engine } from "./engine". `pub use` re-exports, so lib.rs writes `router::Engine`.
pub use engine::Engine;
pub use wavetable::{CYCLE, LEVELS};

use crate::plan::{CHANNELS, VOICE_SIGNALS};

// TS: export const BLOCK = 128; const SLOT = BLOCK + 1; ...
pub const BLOCK: usize = 128;
const SLOT: usize = BLOCK + 1;
/// How often control inputs are read, in samples.
const CONTROL: usize = 32;
/// A released voice whose output stays below this for a whole block has finished.
const SILENCE: f32 = 1e-4;

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
