//! The rhythm nodes (INST-11.2): they take a clock's ticks and pass some on, so what plays them
//! (a pick) plays on a rhythm rather than every step.
//!
//! - **euclid**: passes the ticks on the onsets of `pulses` hits spread as evenly as possible over
//!   `steps` (Bjorklund's algorithm, as euclid/pattern.ts had it), turned by `rotate`. It is a pure
//!   function of the step, so the rhythm locks to the transport like the clock. Each tick it passes is
//!   numbered by hit rather than step, so a pick after it walks the chord one note a hit, and carries
//!   `accent`: every hit but the cycle's first is that much quieter.
//! - **ratchet**: plays each tick `repeats` times, evenly through its step, each a step that long.
//!   Repeats after the block's end wait for the next.

use super::nodes::{Context, push};
use super::{Event, Field, MAX_EVENTS, Timed};
use crate::router::BLOCK;

/// The most steps a Euclidean pattern has: one bit each in a u64.
const MAX_STEPS: usize = 64;

/// A pattern: bit n set for an onset at step n, and how many steps.
// TS: type Pattern = [onsets: bigint, steps: number]
type Pattern = (u64, usize);

/// One group of Bjorklund's algorithm: its steps as bits (first step lowest), and how many.
type Group = (u64, usize);

/// `pulses` onsets spread as evenly as possible over `steps`, turned by `rotate`, as
/// euclid/pattern.ts's `euclideanPattern`: no pulses is silence, as many as steps or more is every step.
// TS: euclideanPattern(steps, pulses, rotate)
pub fn pattern(steps: f64, pulses: f64, rotate: f64) -> Pattern {
    let steps = (steps.round() as usize).clamp(1, MAX_STEPS);
    let pulses = pulses.round().max(0.0) as usize;
    // TS: steps === 64 ? all 64 bits : (1n << steps) - 1n
    let all = if steps == MAX_STEPS { u64::MAX } else { (1 << steps) - 1 };
    if pulses == 0 {
        return (0, steps);
    }
    if pulses >= steps {
        return (all, steps);
    }
    let base = bjorklund(steps, pulses);
    // TS: return base.map((_, index) => base[(index + shift) % steps])  (as bits: rotate right by `shift`)
    let shift = (rotate.round() as i64).rem_euclid(steps as i64) as usize;
    let rotated = if shift == 0 { base } else { ((base >> shift) | (base << (steps - shift))) & all };
    (rotated, steps)
}

/// Bjorklund's algorithm as euclid/pattern.ts writes it: fold the shorter list of groups into the
/// longer until one group or none is left over, then lay them end to end. Groups are bit runs, so
/// nothing allocates.
// TS:
//   let front = pulses x [true], remainder = (steps - pulses) x [false];
//   while (remainder.length > 1) { pair them off; front = the pairs; remainder = front's leftovers, or remainder's }
//   return [...front, ...remainder].flat();
fn bjorklund(steps: usize, pulses: usize) -> u64 {
    // `[value; N]` is an array of N copies, on the stack.
    let mut front: [Group; MAX_STEPS] = [(1, 1); MAX_STEPS];
    let mut remainder: [Group; MAX_STEPS] = [(0, 1); MAX_STEPS];
    let (mut front_count, mut remainder_count) = (pulses, steps - pulses);
    // Each turn pairs at least one group off, so the remainder shrinks and it ends.
    while remainder_count > 1 {
        let pairs = front_count.min(remainder_count);
        // TS: const merged = front.slice(0, pairs).map((group, index) => [...group, ...remainder[index]])
        let mut merged = front;
        (0..pairs).for_each(|index| {
            let ((bits, length), (more, extra)) = (front[index], remainder[index]);
            merged[index] = (bits | (more << length), length + extra);
        });
        // TS: remainder = front.slice(pairs).length ? front.slice(pairs) : remainder.slice(pairs)
        let mut next = [(0, 0); MAX_STEPS];
        let next_count = if front_count > pairs {
            next[..front_count - pairs].copy_from_slice(&front[pairs..front_count]);
            front_count - pairs
        } else {
            next[..remainder_count - pairs].copy_from_slice(&remainder[pairs..remainder_count]);
            remainder_count - pairs
        };
        front = merged;
        front_count = pairs;
        remainder = next;
        remainder_count = next_count;
    }
    // TS: [...front, ...remainder].flat()
    let (mut bits, mut at) = (0, 0);
    front[..front_count].iter().chain(&remainder[..remainder_count]).for_each(|&(group, length)| {
        bits |= group << at;
        at += length;
    });
    bits
}

/// Pass on the ticks landing on an onset. Fields: steps, pulses, rotate, accent.
// TS: for (const [offset, tick] of ticks) { const [onsets, steps] = pattern(...); if (onset at tick.step % steps) out.push([offset, { ...tick, step: hit number, level }]) }
pub fn euclid(ticks: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
    for &(offset, event) in ticks {
        // `let pattern = value else { ... }` unpacks a tick, or skips anything else: TS's `if (event.kind !== "tick") continue`.
        let Event::Tick { step, samples, level } = event else { continue };
        let (onsets, steps) = pattern(context.field(fields, 0, step), context.field(fields, 1, step), context.field(fields, 2, step));
        let position = step.rem_euclid(steps as i64) as u32;
        if onsets & (1 << position) == 0 {
            continue;
        }
        // TS: const before = onsets in the cycle before this one; const hit = Math.floor(step / steps) * pulses + before
        // `count_ones` counts the bits set.
        let before = i64::from((onsets & ((1 << position) - 1)).count_ones());
        let hit = step.div_euclid(steps as i64) * i64::from(onsets.count_ones()) + before;
        let accent = context.field(fields, 3, step).clamp(0.0, 1.0) as f32;
        let level = if before == 0 { level } else { level * (1.0 - accent) };
        push(out, offset, Event::Tick { step: hit, samples, level });
    }
}

/// The ticks waiting to be played: when (samples from the coming block's start), and the tick.
// TS: class Ratchet { waiting: [at: number, tick: Tick][] = [] }
pub struct Ratchet {
    waiting: Vec<(f64, Event)>,
}

impl Ratchet {
    // TS: new Ratchet()
    pub fn new() -> Self {
        Ratchet { waiting: Vec::with_capacity(MAX_EVENTS) }
    }

    /// Each tick `repeats` times through its step, in time order with those waiting from before.
    /// Field: repeats.
    // TS:
    //   for (const [offset, tick] of ticks) { const repeats = ...; for (r < repeats) waiting.push([offset + r * tick.samples / repeats, { ...tick, samples: tick.samples / repeats }]) }
    //   while (one waiting is due this block) { take the earliest; out.push([Math.round(at), tick]) }
    //   waiting.forEach((waiting) => waiting[0] -= BLOCK)
    pub fn process(&mut self, ticks: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        for &(offset, event) in ticks {
            let Event::Tick { step, samples, level } = event else { continue };
            let repeats = context.field(fields, 0, step).round().clamp(1.0, 8.0) as usize;
            let each = samples / repeats as f64;
            (0..repeats).for_each(|repeat| {
                if self.waiting.len() < self.waiting.capacity() {
                    self.waiting.push((offset as f64 + repeat as f64 * each, Event::Tick { step, samples: each, level }));
                }
            });
        }
        // Each turn takes one waiting tick away, so it ends.
        while let Some(at) = self.due() {
            let (time, tick) = self.waiting.swap_remove(at);
            push(out, time.round() as usize, tick);
        }
        self.waiting.iter_mut().for_each(|(time, _)| *time -= BLOCK as f64);
    }

    /// The earliest tick due in this block, if any.
    // TS: the index of the waiting tick with the least `at`, if it rounds to before BLOCK
    fn due(&self) -> Option<usize> {
        let (at, &(time, _)) = self.waiting.iter().enumerate().min_by(|(_, (one, _)), (_, (other, _))| one.total_cmp(other))?;
        (time.round() < BLOCK as f64).then_some(at)
    }

    // TS: this.waiting = []
    pub fn clear(&mut self) {
        self.waiting.clear();
    }
}
