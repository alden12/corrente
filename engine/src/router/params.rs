//! A track's params as the engine keeps them: each a buffer for the block, ramping to each new value.

use super::{BLOCK, SILENT_SLOT, Slot};

/// A param's smoothed buffer: each change ramps from where it was (`from`) to `target` over `ramp`
/// samples, a block unless JS says longer (a bypass fades over 20 ms, so it doesn't thump).
// `Clone` lets `vec![ParamSource::default(); n]` copy it n times; it isn't `Copy` (copied
// implicitly) because a 129-float array is too big to copy without saying so.
#[derive(Clone)]
pub(super) struct ParamSource {
    pub(super) from: f32,
    pub(super) target: f32,
    /// How far into the ramp it is, in samples, up to `ramp`.
    pub(super) elapsed: usize,
    pub(super) ramp: usize,
    pub(super) buffer: Slot,
}

// `Default` is a standard trait for "a sensible starting value". `Self` is the type being implemented.
impl Default for ParamSource {
    fn default() -> Self {
        Self { from: 0.0, target: 0.0, elapsed: BLOCK, ramp: BLOCK, buffer: SILENT_SLOT }
    }
}

impl ParamSource {
    /// Its value `ahead` samples on from where the ramp is.
    // TS: return this.from + (this.target - this.from) * Math.min(this.elapsed + ahead, this.ramp) / this.ramp
    pub(super) fn value(&self, ahead: usize) -> f32 {
        let done = (self.elapsed + ahead).min(self.ramp);
        self.from + (self.target - self.from) * done as f32 / self.ramp as f32
    }

    /// Fill the block's buffer along the ramp (slot 0 is where it was), and move along it.
    // TS: this.buffer.forEach((_, index) => (this.buffer[index] = this.value(index))); this.elapsed = Math.min(this.elapsed + BLOCK, this.ramp);
    pub(super) fn advance(&mut self) {
        // The buffer is taken out first, so `self.value` can read the rest of `self` while it's filled.
        let mut buffer = self.buffer;
        buffer.iter_mut().enumerate().for_each(|(index, sample)| *sample = self.value(index));
        self.buffer = buffer;
        self.elapsed = (self.elapsed + BLOCK).min(self.ramp);
    }
}
