//! What a node reads while it runs: the other buffers of its section, around its own, and what the
//! section shares (the pre section's buffers, a voice's signals, the voice sum, params, constants).
//!
//! Rust notes, for reading this file:
//! - The `'a` in `Sources<'a>` is a **lifetime**: a name for "as long as the borrowed buffers live".
//!   It lets the compiler prove a `Sources` is never used after the buffers it points into go away.

use super::Slot;
use super::track::ParamSource;
use crate::plan::{CHANNELS, HOST_SIGNALS, MAX_INPUTS, MAX_OUTPUTS, Source, VOICE_SIGNALS};

/// What a section reads besides its own buffers. The same for every node in it, so it is built once
/// per section and copied (it is only loans, so copying is cheap).
// `#[derive(Clone, Copy)]` on a struct of loans: copying it copies the loans, not what they point at.
#[derive(Clone, Copy)]
pub(super) struct Context<'a> {
    /// The pre section's buffers, and where each of its nodes' outputs start.
    pub(super) shared: &'a [Slot],
    pub(super) shared_base: &'a [usize],
    pub(super) signals: &'a [Slot; VOICE_SIGNALS],
    pub(super) voice_sum: &'a [Slot; CHANNELS],
    pub(super) inputs: &'a [Slot; MAX_INPUTS],
    pub(super) host: &'a [Slot; HOST_SIGNALS],
    pub(super) params: &'a [ParamSource],
    pub(super) constants: &'a [Slot],
}

/// Everything a node reads, with its own buffers split off to be written. A node only reads its own
/// output as a one-sample feedback edge, and then it reads `own`, a copy taken before the split.
// Every loan field is read-only (`&'a`), all valid for the same lifetime 'a.
pub(super) struct Sources<'a> {
    pub(super) base: &'a [usize],
    /// The node's own buffers are `first .. first + count`, missing from `before` and `after`.
    pub(super) first: usize,
    pub(super) count: usize,
    pub(super) before: &'a [Slot],
    pub(super) after: &'a [Slot],
    pub(super) own: Option<[f32; MAX_OUTPUTS]>,
    pub(super) context: Context<'a>,
}

// TS: function span(slot: Slot, from: number, length: number) { return slot.subarray(from, from + length) }
// The result borrows from `slot`, which the compiler works out from the one `&` argument.
fn span(slot: &Slot, from: usize, length: usize) -> &[f32] {
    &slot[from..from + length]
}

impl<'a> Sources<'a> {
    /// Sources for reading a whole section's buffers, when no node of it is running (its outputs).
    // TS: static whole(base, buffers, context) { return { base, first: buffers.length, count: 0, before: buffers, after: [], context } }
    pub(super) fn whole(base: &'a [usize], buffers: &'a [Slot], context: Context<'a>) -> Self {
        Sources { base, first: buffers.len(), count: 0, before: buffers, after: &[], own: None, context }
    }

    /// Samples from a node's output in this section, starting at slot index `from`.
    // TS:
    //   if (index < first) return span(before[index], from, length);
    //   if (index >= first + count) return span(after[index - first - count], from, length);
    //   return own.subarray(index - first, index - first + 1);  // a feedback edge onto itself: one sample
    // `&own[i..=i]` is a one-element slice; `..=` includes its end.
    fn buffer(&self, node: usize, port: usize, from: usize, length: usize) -> &[f32] {
        let index = self.base[node] + port;
        if index < self.first {
            span(&self.before[index], from, length)
        } else if index >= self.first + self.count {
            span(&self.after[index - self.first - self.count], from, length)
        } else {
            let own = self.own.as_ref().expect("a node reading itself gets a copy");
            &own[index - self.first..=index - self.first]
        }
    }

    /// Samples [start, start + length) of a source; a feedback edge reads each one a sample early.
    // TS: switch (source.type) { case "buffer": return this.buffer(source.node, source.port, start + 1, length); ... }
    pub(super) fn samples(&self, source: Source, start: usize, length: usize) -> &[f32] {
        let context = &self.context;
        match source {
            Source::Buffer(node, port) => self.buffer(node, port, start + 1, length),
            Source::Previous(node, port) => self.buffer(node, port, start, length),
            Source::Shared(node, port) => span(&context.shared[context.shared_base[node] + port], start + 1, length),
            Source::Param(param) => span(&context.params[param].buffer, start + 1, length),
            Source::Const(constant) => span(&context.constants[constant], start + 1, length),
            Source::Voice(signal) => span(&context.signals[signal], start + 1, length),
            Source::VoiceSum(channel) => span(&context.voice_sum[channel], start + 1, length),
            Source::Input(channel) => span(&context.inputs[channel], start + 1, length),
            Source::Host(signal) => span(&context.host[signal], start + 1, length),
        }
    }
}
