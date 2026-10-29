//! The strum node (INST-35): notes that start together, a chord, are spread out in time like a
//! guitar strum, each `spread` beats after the one before. The first node that moves notes later in
//! time, so it keeps what's waiting to be played, and each note's off waits as long as its on did.
//!
//! - **Together** means starting within `window` beats of the first note of the strum, so a chord
//!   played by hand, a little ragged, strums too.
//! - **Direction:** notes landing on the same sample are strummed from the lowest up, the highest
//!   down, or alternately up then down, strum by strum. Notes landing later in the window follow on
//!   in the order they came.
//! - **Tilt:** each note after the first is `tilt` louder (or quieter, below 0) than the one before.

use super::nodes::{Context, push};
use super::{Event, Field, MAX_EVENTS, MAX_HELD, Timed};
use crate::router::BLOCK;

/// The directions, by the number the field gives; anything else strums up (0).
const DOWN: usize = 1;
const ALTERNATE: usize = 2;

/// A strum's notes waiting to play: when (on the node's own clock), in what order they came, and the event.
// TS: type Waiting = [due: number, order: number, event: Event]
type Waiting = (u64, u64, Event);

// TS: class Strum { now = 0; strum?: [start: number, count: number]; down = true; waiting: Waiting[] = []; delays = new Array(128).fill(0); sounding = new Set<number>(); order = 0 }
pub struct Strum {
    /// Samples since the node started: its own clock, so a delay can run past the block.
    now: u64,
    /// The strum notes are joining: when its first note started, and how many have joined.
    strum: Option<(u64, usize)>,
    /// Whether the strum going now is downward. It starts true, so alternate's first strum goes up.
    down: bool,
    waiting: Vec<Waiting>,
    /// By note: the delay its last note on was given, so its note off waits as long.
    delays: [u64; 128],
    /// Notes this node has played on and not yet let go, as bits, so letting go of everything can.
    sounding: u128,
    order: u64,
}

impl Strum {
    // TS: new Strum()
    pub fn new() -> Self {
        Strum { now: 0, strum: None, down: true, waiting: Vec::with_capacity(MAX_EVENTS), delays: [0; 128], sounding: 0, order: 0 }
    }

    /// Spread the notes coming in, and play what's due in this block. Fields: spread, direction,
    /// tilt, window.
    // TS:
    //   for (each run of note ons on the same sample, put in the strum's direction) this.join(...)
    //   note offs wait as long as their note's on did; then play every waiting event due before the block ends
    pub fn process(&mut self, notes: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        let per_sample = context.transport.per_sample.max(1e-12);
        let samples = |index: usize| (context.field(fields, index, 0).max(0.0) / per_sample).round() as u64;
        let (spread, window) = (samples(0), samples(3));
        let direction = context.field(fields, 1, 0).round() as usize;
        let tilt = context.field(fields, 2, 0) as f32;
        let mut at = 0;
        // Each turn takes one event or one run of note ons, so it ends.
        while at < notes.len() {
            let (offset, event) = notes[at];
            let time = self.now + offset as u64;
            let Event::On { .. } = event else {
                // TS: if (event.kind === "off") this.wait(time + this.delays[note], event)
                if let Event::Off { note } = event {
                    let key = note.clamp(0, 127) as usize;
                    self.wait(time + self.delays[key], event);
                }
                at += 1;
                continue;
            };
            // The run of note ons on this sample, in the strum's direction: on the stack, so nothing allocates.
            // TS: const run = notes.slice(at).takeWhile(([o, e]) => o === offset && e.kind === "on").sort(by pitch, in the direction)
            let run_length = notes[at..].iter().take_while(|&&(other, event)| other == offset && matches!(event, Event::On { .. })).count();
            let mut run = [(0, 0.0, None); MAX_HELD];
            let count = run_length.min(MAX_HELD);
            notes[at..at + count].iter().zip(run.iter_mut()).for_each(|(&(_, event), slot)| {
                if let Event::On { note, velocity, length } = event {
                    *slot = (note, velocity, length);
                }
            });
            let starts = self.strum.is_none_or(|(start, _)| time > start + window);
            if starts {
                self.strum = Some((time, 0));
                self.down = match direction {
                    DOWN => true,
                    ALTERNATE => !self.down,
                    _ => false,
                };
            }
            // `sort_unstable_by_key` sorts in place; a downward strum takes the highest note first.
            let down = self.down;
            run[..count].sort_unstable_by_key(|&(note, _, _)| if down { -note } else { note });
            run[..count].iter().for_each(|&(note, velocity, length)| self.join(time, note, velocity, length, spread, tilt));
            at += run_length;
        }
        // TS: while (one is due this block) { take the earliest (first come at a tie); out.push([due - now, event]) }
        let end = self.now + BLOCK as u64;
        // Each turn takes one waiting event away, so it ends.
        while let Some(at) = self.due(end) {
            let (due, _, event) = self.waiting.swap_remove(at);
            match event {
                Event::On { note, length: None, .. } => self.sounding |= 1 << note.clamp(0, 127),
                Event::Off { note } => self.sounding &= !(1 << note.clamp(0, 127)),
                _ => {}
            }
            push(out, (due - self.now) as usize, event);
        }
        self.now = end;
    }

    /// A note on joining the strum going now: it waits a spread for every note before it, `tilt`
    /// louder for each.
    // TS: const [start, count] = this.strum; this.strum = [start, count + 1]; this.delays[note] = count * spread; this.wait(time + count * spread, on(note, velocity * (1 + tilt * count)))
    fn join(&mut self, time: u64, note: i32, velocity: f32, length: Option<u32>, spread: u64, tilt: f32) {
        let Some((start, count)) = self.strum else { return };
        self.strum = Some((start, count + 1));
        let delay = count as u64 * spread;
        self.delays[note.clamp(0, 127) as usize] = delay;
        let velocity = (velocity * (1.0 + tilt * count as f32)).clamp(0.0, 1.0);
        self.wait(time + delay, Event::On { note, velocity, length });
    }

    // TS: if (this.waiting.length < MAX_EVENTS) this.waiting.push([due, this.order++, event])
    fn wait(&mut self, due: u64, event: Event) {
        if self.waiting.len() < self.waiting.capacity() {
            self.waiting.push((due, self.order, event));
            self.order += 1;
        }
    }

    /// The earliest waiting event due before `end`, first come at a tie.
    // TS: the index of the least [due, order] in waiting, if its due is before end
    fn due(&self, end: u64) -> Option<usize> {
        let (at, &(due, _, _)) = self.waiting.iter().enumerate().min_by_key(|&(_, &(due, order, _))| (due, order))?;
        (due < end).then_some(at)
    }

    /// Drop what's waiting, and let go of the notes it played that are still sounding, at `offset`.
    // TS: this.waiting = []; this.strum = undefined; this.down = true; for (const note of this.sounding) out.push([offset, off(note)]); this.sounding.clear()
    pub fn clear(&mut self, offset: usize, out: &mut Vec<Timed>) {
        self.waiting.clear();
        self.strum = None;
        self.down = true;
        (0..128).filter(|&note| self.sounding >> note & 1 == 1).for_each(|note| push(out, offset, Event::Off { note }));
        self.sounding = 0;
    }
}
