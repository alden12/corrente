//! The nodes that work across time (INST-11), each small, so a device is built from them rather
//! than given a node of its own: a strum is `order` then `delay` by index, an echo a `stack` then
//! `delay` by index, a gate a `length` after a `pick`.
//!
//! - **order**: numbers the notes that start together, a chord, by their place in it. Notes landing on
//!   the same sample are numbered from the lowest up, the highest down, or alternately up then down,
//!   chord by chord; notes landing later, within `window` beats of the first, follow on in the order
//!   they came. Its note offs carry the same numbers.
//! - **delay**: plays each note `beats` later (a field, so it can read the note's index), and its note
//!   off as much later as its note on was. It keeps what's waiting, so a delay runs past the block.
//! - **chance**: lets each note on through with `probability`, drawn the same way every time, and
//!   drops the note off of one it didn't let through.
//!
//! **length** has no state, so it's in nodes.rs.

use super::nodes::{Context, push};
use super::{Event, Field, MAX_EVENTS, MAX_HELD, NoteContext, Timed, draw};
use crate::router::BLOCK;

/// The most indices a note can carry and still be told apart from its copies: a delay and a chance
/// keep state per note and index, up to this.
const INDICES: usize = 16;

// TS: Math.min(index, INDICES - 1)
fn slot(index: u8) -> usize {
    usize::from(index).min(INDICES - 1)
}

// TS: Math.max(0, Math.min(127, note))
fn key(note: i32) -> usize {
    note.clamp(0, 127) as usize
}

/// The directions, by the number the field gives; anything else numbers up (0).
const DOWN: usize = 1;
const ALTERNATE: usize = 2;

// TS: class Order { now = 0; chord?: [start: number, count: number]; down = true; indices = new Array(128).fill(0) }
pub struct Order {
    /// Samples since the node started: its own clock, for the window.
    now: u64,
    /// The chord notes are joining: when its first note started, and how many have joined.
    chord: Option<(u64, usize)>,
    /// Whether the chord numbered now goes down. It starts true, so alternate's first chord goes up.
    down: bool,
    /// By note: the index its last note on was given, for its note off.
    indices: [u8; 128],
}

impl Order {
    // TS: new Order()
    pub fn new() -> Self {
        Order { now: 0, chord: None, down: true, indices: [0; 128] }
    }

    /// Number the notes coming in. Fields: direction, window.
    // TS: for (each run of note ons on the same sample, in the chord's direction) number them; note offs take their on's number
    pub fn process(&mut self, notes: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        let per_sample = context.transport.per_sample.max(1e-12);
        let window = (context.field(fields, 1, 0).max(0.0) / per_sample).round() as u64;
        let direction = context.field(fields, 0, 0).round() as usize;
        let mut at = 0;
        // Each turn takes one event or one run of note ons, so it ends.
        while at < notes.len() {
            let (offset, event) = notes[at];
            // `let pattern = value else { ... }` unpacks a note on, or handles anything else: TS's `if (event.kind !== "on") { ...; continue }`.
            let Event::On { .. } = event else {
                // TS: out.push([offset, event.kind === "off" ? { ...event, index: this.indices[event.note] } : event])
                let event = match event {
                    Event::Off { note, .. } => Event::Off { note, index: self.indices[key(note)] },
                    other => other,
                };
                push(out, offset, event);
                at += 1;
                continue;
            };
            let time = self.now + offset as u64;
            // The run of note ons on this sample, on the stack, so nothing allocates.
            // TS: const run = notes.slice(at).takeWhile(([o, e]) => o === offset && e.kind === "on")
            let run_length = notes[at..].iter().take_while(|&&(other, event)| other == offset && matches!(event, Event::On { .. })).count();
            let mut run = [event; MAX_HELD];
            let count = run_length.min(MAX_HELD);
            run[..count].iter_mut().zip(&notes[at..at + count]).for_each(|(slot, &(_, event))| *slot = event);
            if self.chord.is_none_or(|(start, _)| time > start + window) {
                self.chord = Some((time, 0));
                self.down = match direction {
                    DOWN => true,
                    ALTERNATE => !self.down,
                    _ => false,
                };
            }
            // `sort_unstable_by_key` sorts in place; a chord going down takes the highest note first.
            let down = self.down;
            run[..count].sort_unstable_by_key(|event| {
                let NoteContext { pitch, .. } = NoteContext::of(*event);
                if down { -pitch } else { pitch }
            });
            run[..count].iter().for_each(|&event| {
                let Event::On { note, velocity, length, .. } = event else { return };
                let Some((start, joined)) = self.chord else { return };
                self.chord = Some((start, joined + 1));
                let index = joined.min(255) as u8;
                self.indices[key(note)] = index;
                push(out, offset, Event::On { note, velocity, length, index });
            });
            at += run_length;
        }
        self.now += BLOCK as u64;
    }

    // TS: this.chord = undefined; this.down = true
    pub fn clear(&mut self) {
        self.chord = None;
        self.down = true;
    }
}

/// An event waiting to play: when (on the node's own clock), in what order it came, and the event.
// TS: type Waiting = [due: number, order: number, event: Event]
type Waiting = (u64, u64, Event);

// TS: class Delay { now = 0; waiting: Waiting[] = []; delays: number[][] (by note, index); sounding: Set<[note, index]>; order = 0 }
pub struct Delay {
    now: u64,
    waiting: Vec<Waiting>,
    /// By note and index: the delay its last note on was given, so its note off waits as long.
    delays: [[u64; INDICES]; 128],
    /// By note: the indices this node has played on and not yet let go, as bits, so clearing can.
    sounding: [u16; 128],
    order: u64,
}

impl Delay {
    // TS: new Delay()
    pub fn new() -> Self {
        Delay { now: 0, waiting: Vec::with_capacity(MAX_EVENTS), delays: [[0; INDICES]; 128], sounding: [0; 128], order: 0 }
    }

    /// Hold each note back `beats` (read for the note), each note off as long as its on, and play
    /// what's due in this block. Field: beats.
    // TS: notes.forEach(([offset, event]) => this.wait(...)); then play every waiting event due before the block ends
    pub fn process(&mut self, notes: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        let per_sample = context.transport.per_sample.max(1e-12);
        for &(offset, event) in notes {
            let time = self.now + offset as u64;
            match event {
                Event::On { note, index, .. } => {
                    let beats = context.note_field(fields, 0, NoteContext::of(event)).max(0.0);
                    let delay = (beats / per_sample).round() as u64;
                    self.delays[key(note)][slot(index)] = delay;
                    self.wait(time + delay, event);
                }
                Event::Off { note, index } => self.wait(time + self.delays[key(note)][slot(index)], event),
                Event::Tick { .. } => {}
            }
        }
        let end = self.now + BLOCK as u64;
        // Each turn takes one waiting event away, so it ends.
        while let Some(at) = self.due(end) {
            let (due, _, event) = self.waiting.swap_remove(at);
            match event {
                Event::On { note, length: None, index, .. } => self.sounding[key(note)] |= 1 << slot(index),
                Event::Off { note, index } => self.sounding[key(note)] &= !(1 << slot(index)),
                _ => {}
            }
            push(out, (due - self.now) as usize, event);
        }
        self.now = end;
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
    // TS: this.waiting = []; this.sounding.forEach(([note, index]) => out.push([offset, off(note, index)])); this.sounding.clear()
    pub fn clear(&mut self, offset: usize, out: &mut Vec<Timed>) {
        self.waiting.clear();
        (0..128).for_each(|note| {
            (0..INDICES).filter(|&index| self.sounding[note] >> index & 1 == 1).for_each(|index| {
                push(out, offset, Event::Off { note: note as i32, index: index as u8 });
            });
            self.sounding[note] = 0;
        });
    }
}

// TS: class Chance { count = 0; dropped: Set<[note, index]> }
pub struct Chance {
    /// How many note ons it has decided on: what each draw is seeded by, so a render replays it.
    count: i64,
    /// By note: the indices of note ons it dropped, as bits, so their note offs go too.
    dropped: [u16; 128],
}

impl Chance {
    // TS: new Chance()
    pub fn new() -> Self {
        Chance { count: 0, dropped: [0; 128] }
    }

    /// Let each note on through with `probability` (read for the note), and its note off with it.
    /// Field: probability.
    // TS: for (const [offset, event] of notes) { on: keep if draw() < probability, else remember it; off: drop if its on was dropped }
    pub fn process(&mut self, notes: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        for &(offset, event) in notes {
            match event {
                Event::On { note, length, index, .. } => {
                    let probability = context.note_field(fields, 0, NoteContext::of(event));
                    let kept = draw(context.seed, context.node, 0, self.count) < probability;
                    self.count += 1;
                    let bit = 1 << slot(index);
                    // A note with a length has no note off coming, so there's nothing to remember.
                    if kept || length.is_some() {
                        self.dropped[key(note)] &= !bit;
                    } else {
                        self.dropped[key(note)] |= bit;
                    }
                    if kept {
                        push(out, offset, event);
                    }
                }
                Event::Off { note, index } => {
                    if self.dropped[key(note)] >> slot(index) & 1 == 1 {
                        self.dropped[key(note)] &= !(1 << slot(index));
                    } else {
                        push(out, offset, event);
                    }
                }
                Event::Tick { .. } => {}
            }
        }
    }

    // TS: this.dropped.clear()
    pub fn clear(&mut self) {
        self.dropped = [0; 128];
    }
}
