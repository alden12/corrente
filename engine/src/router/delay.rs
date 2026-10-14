//! The native delay line (`KIND_DELAY`): a ring of past inputs, read and written by the router
//! itself rather than inside a Faust block, so that in a feedback loop its read and its write can go
//! either side of the other blocks.
//!
//! **Its ring is as long as its plan asks** (INST-36.7): the `size` control, a literal in the plan,
//! read once when the node is made, so a string's delay stays small (it is copied per voice) and an
//! echo's can hold seconds.

use super::BLOCK;
use super::render::{Render, Unit};

/// The longest delay when the plan doesn't say (a 4096-sample ring): a string down to about 12 Hz.
pub const DEFAULT_SIZE: usize = 4094;
/// The longest ring: 2^21 samples, about 43 seconds at 48 kHz (8MB).
pub const LARGEST_SIZE: usize = 1 << 21;

/// A delay line's state: a ring of past inputs. out[t] = in[t - samples].
// `Box<[f32]>` puts the ring on the heap, its length fixed when it's made.
pub(super) struct DelayLine {
    ring: Box<[f32]>,
    // TS: x & mask is x % ring.length, cheaper because the length is a power of two.
    mask: usize,
    longest: f32,
    write: usize,
}

impl DelayLine {
    /// A ring holding at least `size` samples of delay (a power of two, for masking).
    // TS: const length = nextPowerOfTwo(clamp(size + 2, 4, LARGEST_SIZE))
    pub(super) fn new(size: usize) -> Self {
        let length = (size + 2).clamp(4, LARGEST_SIZE).next_power_of_two();
        DelayLine { ring: vec![0.0; length].into_boxed_slice(), mask: length - 1, longest: (length - 2) as f32, write: 0 }
    }

    // TS: clear() { this.ring.fill(0) }
    pub(super) fn clear(&mut self) {
        self.ring.fill(0.0);
    }

    /// The longest delay it plays: a longer one is cut to this.
    // TS: get longest() { return this.longest }
    pub(super) fn longest(&self) -> f32 {
        self.longest
    }

    /// How many samples its ring holds: two lines can only swap state if they match.
    // TS: get length() { return this.ring.length }
    pub(super) fn length(&self) -> usize {
        self.ring.len()
    }

    /// The input `delay` samples before position `write + offset`, interpolated linearly.
    // TS: `delay as usize` is Math.trunc(delay); the rest is the same arithmetic.
    fn tap(&self, offset: usize, delay: f32) -> f32 {
        let whole = delay as usize;
        let fraction = delay - whole as f32;
        let newer = (self.write + offset + self.ring.len() - whole) & self.mask;
        let older = (newer + self.mask) & self.mask;
        self.ring[newer] * (1.0 - fraction) + self.ring[older] * fraction
    }
}

// More of Render's methods: the ones that run a delay node. The rest are in render.rs.
impl Render<'_> {
    /// A delay outside any loop: write each sample then read, so a delay of 0 passes straight through.
    pub(super) fn run_delay(&mut self, index: usize) {
        self.with_node(index, 0, |node, unit, outputs, sources| {
            // TS: if (unit.type !== "delay") return; const line = unit.line;
            // The pattern `Unit::Delay(line)` both checks the variant and names the DelayLine it
            // carries: `line` is a new variable, made here.
            let Unit::Delay(line) = unit else { return };
            let input = sources.samples(node.audio[0], 0, BLOCK);
            let lengths = sources.samples(node.audio[1], 0, BLOCK);
            // TS: for (let i = 0; i < BLOCK; i++) { line.ring[line.write] = input[i]; outputs[0][i + 1] = line.tap(0, clamp(lengths[i])); line.write = (line.write + 1) & line.mask; }
            // Zipping three lists gives nested pairs, `((sample, length), out)`.
            input.iter().zip(lengths).zip(&mut outputs[0][1..]).for_each(|((&sample, &length), out)| {
                line.ring[line.write] = sample;
                *out = line.tap(0, length.min(line.longest).max(0.0));
                line.write = (line.write + 1) & line.mask;
            });
        });
    }

    /// A delay's output over [start, start + length), from what it has already been given.
    pub(super) fn delay_read(&mut self, index: usize, start: usize, length: usize) {
        self.with_node(index, start, |node, unit, outputs, sources| {
            // TS: if (unit.type !== "delay") return; const line = unit.line;
            let Unit::Delay(line) = unit else { return };
            let lengths = sources.samples(node.audio[1], start, length);
            let output = &mut outputs[0][start + 1..start + 1 + length];
            // `write` is where sample `start` will go: each output is offset samples on from it.
            // TS: lengths.forEach((delay, offset) => (output[offset] = line.tap(offset, clamp(delay))))
            lengths.iter().zip(output).enumerate().for_each(|(offset, (&delay, out))| {
                *out = line.tap(offset, delay.min(line.longest).max(1.0));
            });
        });
    }

    /// Give a delay its input over [start, start + length).
    pub(super) fn delay_write(&mut self, index: usize, start: usize, length: usize) {
        // `_outputs`: given but unused, hence the underscore.
        self.with_node(index, start, |node, unit, _outputs, sources| {
            // TS: if (unit.type !== "delay") return; const line = unit.line;
            let Unit::Delay(line) = unit else { return };
            // In a one-sample loop the input can be a feedback edge, read as the sample before.
            sources.samples(node.audio[0], start, length).iter().for_each(|&sample| {
                line.ring[line.write] = sample;
                line.write = (line.write + 1) & line.mask;
            });
        });
    }
}
