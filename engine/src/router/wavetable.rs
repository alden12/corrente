//! The native wavetable oscillator (`KIND_WAVETABLE`, INST-36.6): one cycle of a waveform read over
//! and over at the note's frequency, morphing through a set of cycles by `position`. The tables live
//! in the bank's sample slots, like samples, so they load on use and are shared the same way.
//!
//! - **A table** is a run of single cycles, CYCLE samples each, from dark to bright (a built-in set, or
//!   a wavetable WAV file, which is the same thing).
//! - **Band-limited:** JS stores each table LEVELS times, each level with half the harmonics of the one
//!   before (all of them, then 512, 256, ... down to 1). A note reads the brightest level with no
//!   harmonic above half the sample rate, so high notes don't fold back into noise (aliasing).
//! - **Layout** in the slot: level 0's cycles one after another, then level 1's, and so on, so the
//!   slot holds LEVELS × cycles × CYCLE samples. A slot of any other length plays silence.
//!
//! Rust notes, for reading this file:
//! - `.log2()`, `.ceil()` and `.floor()` are methods on numbers, where JS has `Math.log2(x)` and so on.

use super::render::Chunk;
use super::sources::Sources;
use super::Slot;
use crate::plan::Node;
use super::sampler::Sample;

/// Samples in one cycle of a table: the size wavetable WAV files use.
pub const CYCLE: usize = 2048;
// TS: x & CYCLE_MASK is x % CYCLE, since CYCLE is a power of two.
const CYCLE_MASK: usize = CYCLE - 1;
/// Copies of a table with fewer harmonics each: 1024 harmonics, 512, ... 1.
pub const LEVELS: usize = 11;
/// The most harmonics a cycle can hold: half its length.
const HARMONICS: f32 = (CYCLE / 2) as f32;

/// A wavetable node's state, one per voice.
pub(super) struct WavetableState {
    sample_rate: f32,
    /// The `table` control as last read: the sample slot the table is in.
    table: f32,
    /// Which level to read, chosen from the frequency when the controls are read.
    level: usize,
    /// Where in the cycle it is, 0 to 1.
    phase: f32,
}

impl WavetableState {
    pub(super) fn new(sample_rate: i32) -> Self {
        WavetableState { sample_rate: sample_rate as f32, table: 0.0, level: 0, phase: 0.0 }
    }

    // TS: clear() { this.phase = 0 }
    pub(super) fn clear(&mut self) {
        self.phase = 0.0;
    }

    /// The brightest level whose top harmonic stays under half the sample rate at `frequency`.
    // TS: Math.min(LEVELS - 1, Math.max(0, Math.ceil(Math.log2((HARMONICS * frequency) / (sampleRate / 2)))))
    fn choose_level(&mut self, frequency: f32) {
        let over = HARMONICS * frequency.max(1.0) / (self.sample_rate * 0.5);
        self.level = (over.log2().ceil().max(0.0) as usize).min(LEVELS - 1);
    }

    /// Play `frequencies` and `positions` into `out` from the table in `samples`.
    fn play(&mut self, samples: &[Option<Sample>], frequencies: &[f32], positions: &[f32], out: &mut [f32]) {
        let slot = self.table.round().max(0.0) as usize;
        // TS: const data = samples[slot]?.firstChannel(); const cycles = data ? data.length / (LEVELS * CYCLE) : 0;
        let data = samples.get(slot).and_then(Option::as_ref).map_or(&[][..], Sample::first_channel);
        let cycles = data.len() / (LEVELS * CYCLE);
        if cycles == 0 || data.len() != cycles * LEVELS * CYCLE {
            out.fill(0.0);
            return;
        }
        let level = &data[self.level * cycles * CYCLE..(self.level + 1) * cycles * CYCLE];
        let last = (cycles - 1) as f32;
        // TS: for (let i = 0; i < out.length; i++) { ... }
        frequencies.iter().zip(positions).zip(out.iter_mut()).for_each(|((&frequency, &position), out)| {
            // Where in the cycle, and which two cycles to morph between, by how much.
            let at = self.phase * CYCLE as f32;
            let index = at as usize & CYCLE_MASK;
            let fraction = at - at.floor();
            let morph = position.clamp(0.0, 1.0) * last;
            let first = morph as usize;
            let second = (first + 1).min(cycles - 1);
            let blend = morph - first as f32;
            // TS: const read = (cycle) => { const table = level.subarray(cycle * CYCLE); return table[index] + (table[(index + 1) % CYCLE] - table[index]) * fraction; }
            let read = |cycle: usize| {
                let start = cycle * CYCLE;
                let (a, b) = (level[start + index], level[start + ((index + 1) & CYCLE_MASK)]);
                a + (b - a) * fraction
            };
            let (from, to) = (read(first), read(second));
            *out = from + (to - from) * blend;
            self.phase += frequency.max(0.0) / self.sample_rate;
            self.phase -= self.phase.floor();
        });
    }
}

impl WavetableState {
    /// Run over the chunk, reading its control and choosing its level first if it says.
    // TS: run(node, outputs, sources, samples, { start, length, setControls }) { ... }
    pub(super) fn run(&mut self, node: &Node, outputs: &mut [Slot], sources: &Sources, samples: &[Option<Sample>], chunk: Chunk) {
        let Chunk { start, length, set_controls } = chunk;
        let frequencies = sources.samples(node.audio[0], start, length);
        if set_controls {
            self.table = sources.samples(node.control[0], start, 1)[0];
            self.choose_level(frequencies[0]);
        }
        let positions = sources.samples(node.audio[1], start, length);
        self.play(samples, frequencies, positions, &mut outputs[0][start + 1..start + 1 + length]);
    }
}
