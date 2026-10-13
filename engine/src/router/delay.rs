//! The native delay line (`KIND_DELAY`): a ring of past inputs, read and written by the router
//! itself rather than inside a Faust block, so that in a feedback loop its read and its write can go
//! either side of the other blocks.

use super::BLOCK;
use super::render::{Render, Unit};

/// A power of two, for masking.
const DELAY_SIZE: usize = 4096;
// TS: x & DELAY_MASK is x % DELAY_SIZE, cheaper because the size is a power of two.
const DELAY_MASK: usize = DELAY_SIZE - 1;
const LONGEST_DELAY: f32 = (DELAY_SIZE - 2) as f32;

/// A delay line's state: a ring of past inputs. out[t] = in[t - samples].
// `Box<[f32; 4096]>` puts the 16KB ring on the heap rather than inline in the struct.
pub(super) struct DelayLine {
    ring: Box<[f32; DELAY_SIZE]>,
    write: usize,
}

impl DelayLine {
    pub(super) fn new() -> Self {
        DelayLine { ring: Box::new([0.0; DELAY_SIZE]), write: 0 }
    }

    // TS: clear() { this.ring.fill(0) }
    pub(super) fn clear(&mut self) {
        self.ring.fill(0.0);
    }

    /// The input `delay` samples before position `write + offset`, interpolated linearly.
    // TS: `delay as usize` is Math.trunc(delay); the rest is the same arithmetic.
    fn tap(&self, offset: usize, delay: f32) -> f32 {
        let whole = delay as usize;
        let fraction = delay - whole as f32;
        let newer = (self.write + offset + DELAY_SIZE - whole) & DELAY_MASK;
        let older = (newer + DELAY_MASK) & DELAY_MASK;
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
            // TS: for (let i = 0; i < BLOCK; i++) { line.ring[line.write] = input[i]; outputs[0][i + 1] = line.tap(0, clamp(lengths[i])); line.write = (line.write + 1) & DELAY_MASK; }
            // Zipping three lists gives nested pairs, `((sample, length), out)`.
            input.iter().zip(lengths).zip(&mut outputs[0][1..]).for_each(|((&sample, &length), out)| {
                line.ring[line.write] = sample;
                *out = line.tap(0, length.min(LONGEST_DELAY).max(0.0));
                line.write = (line.write + 1) & DELAY_MASK;
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
                *out = line.tap(offset, delay.min(LONGEST_DELAY).max(1.0));
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
                line.write = (line.write + 1) & DELAY_MASK;
            });
        });
    }
}
