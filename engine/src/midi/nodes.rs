//! The event nodes a MIDI device is made of (INST-11's palette), and what each does with a block's
//! events. midi/format.ts's NODE_SPECS lists the same kinds, ports and fields, in this order: the two
//! change together.
//!
//! - **input**: the notes the device is given.
//! - **clock** (clock.rs): ticks every `beats`, optionally free-running from the first note on `sync`.
//! - **pick**: holds the notes it's given and, on each tick, plays one of them for the tick's step:
//!   walking up, down, up and down, at random, or in the order played; or all of them at once
//!   (chord). At the loudest held velocity, times the tick's level.
//! - **stack**: plays copies of each note, each moved by its interval, its velocity scaled, and on or
//!   off, numbered by copy: an octaver, a chord, a fixed harmony, an echo's repeats.
//! - **transpose**: moves each note by `semitones`.
//! - **velocity**: scales each note's velocity.
//! - **euclid** and **ratchet** (rhythm.rs): pass on some of a clock's ticks, or repeat them.
//! - **order**, **delay**, **length** and **chance** (time.rs): number the notes of a chord, play notes
//!   later, change how long they last, or let them through by chance.
//!
//! A note that's moved keeps track of where it went, so its note off lets go of the same notes even if
//! a knob moved in between. A note off nobody played passes through as it is: letting go of a note
//! that isn't sounding does nothing.

use super::clock::Clock;
use super::rhythm::{self, Ratchet};
use super::time::{Chance, Delay, Order};
use super::{BlockTransport, Event, Field, MAX_COPIES, MAX_EVENTS, MAX_HELD, NoteContext, Timed, draw};

/// What a port or an output carries.
// TS: type Wire = "notes" | "ticks"
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Wire {
    Notes,
    Ticks,
}

/// The node kinds by the number the words give them: each one's input ports, how many fields it
/// takes, and what it outputs. Stack takes its copies' fields three at a time (interval, velocity, on).
// TS: export const NODE_SPECS = [{ name: "input", ports: [], fields: 0, output: "notes" }, ...]
pub struct Spec {
    pub ports: &'static [Wire],
    /// The field count it takes: exactly this many, or, for a stack, any whole number of copies.
    pub fields: Fields,
    pub output: Wire,
}

// TS: type Fields = { exactly: number } | "copies"
pub enum Fields {
    Exactly(usize),
    Copies,
}

// TS: the same list as midi/format.ts's NODE_SPECS, by kind number.
pub const SPECS: [Spec; 12] = [
    Spec { ports: &[], fields: Fields::Exactly(0), output: Wire::Notes },
    Spec { ports: &[Wire::Notes], fields: Fields::Exactly(1), output: Wire::Ticks },
    Spec { ports: &[Wire::Notes, Wire::Ticks], fields: Fields::Exactly(1), output: Wire::Notes },
    Spec { ports: &[Wire::Notes], fields: Fields::Copies, output: Wire::Notes },
    Spec { ports: &[Wire::Notes], fields: Fields::Exactly(1), output: Wire::Notes },
    Spec { ports: &[Wire::Notes], fields: Fields::Exactly(1), output: Wire::Notes },
    Spec { ports: &[Wire::Ticks], fields: Fields::Exactly(4), output: Wire::Ticks },
    Spec { ports: &[Wire::Ticks], fields: Fields::Exactly(1), output: Wire::Ticks },
    Spec { ports: &[Wire::Notes], fields: Fields::Exactly(2), output: Wire::Notes },
    Spec { ports: &[Wire::Notes], fields: Fields::Exactly(1), output: Wire::Notes },
    Spec { ports: &[Wire::Notes], fields: Fields::Exactly(1), output: Wire::Notes },
    Spec { ports: &[Wire::Notes], fields: Fields::Exactly(1), output: Wire::Notes },
];

pub const KIND_INPUT: usize = 0;
pub const KIND_CLOCK: usize = 1;
pub const KIND_PICK: usize = 2;
pub const KIND_STACK: usize = 3;
pub const KIND_TRANSPOSE: usize = 4;
pub const KIND_VELOCITY: usize = 5;
pub const KIND_EUCLID: usize = 6;
pub const KIND_RATCHET: usize = 7;
pub const KIND_ORDER: usize = 8;
pub const KIND_DELAY: usize = 9;
pub const KIND_LENGTH: usize = 10;
pub const KIND_CHANCE: usize = 11;

/// A node's state, by kind.
// TS: a discriminated union of each kind's state.
pub enum Kind {
    Input,
    Clock(Clock),
    Pick(Pick),
    /// Stack and transpose both move notes and remember where each went.
    Stack(NoteMap),
    Transpose(NoteMap),
    Velocity,
    Euclid,
    Ratchet(Ratchet),
    Order(Order),
    Delay(Delay),
    Length,
    Chance(Chance),
}

impl Kind {
    // TS: const KINDS = { [KIND_INPUT]: () => ({ kind: "input" }), ... }; return KINDS[kind]?.()
    pub fn new(kind: usize) -> Option<Kind> {
        Some(match kind {
            KIND_INPUT => Kind::Input,
            KIND_CLOCK => Kind::Clock(Clock::new()),
            KIND_PICK => Kind::Pick(Pick::new()),
            KIND_STACK => Kind::Stack(NoteMap::new()),
            KIND_TRANSPOSE => Kind::Transpose(NoteMap::new()),
            KIND_VELOCITY => Kind::Velocity,
            KIND_EUCLID => Kind::Euclid,
            KIND_RATCHET => Kind::Ratchet(Ratchet::new()),
            KIND_ORDER => Kind::Order(Order::new()),
            KIND_DELAY => Kind::Delay(Delay::new()),
            KIND_LENGTH => Kind::Length,
            KIND_CHANCE => Kind::Chance(Chance::new()),
            _ => return None,
        })
    }
}

/// What every node reads besides its inputs: the chain's values, the transport, and its device's
/// seed and its own place, for random fields.
// TS: interface Context { values: number[]; transport: BlockTransport; seed: bigint; node: number }
// `<'a>`: it lends the chain's values, so it can't outlive them.
pub struct Context<'a> {
    pub values: &'a [f64],
    pub transport: BlockTransport,
    pub seed: u64,
    pub node: usize,
}

impl Context<'_> {
    /// Field `index` of `fields` for a step, drawing a random one for `at` (the step).
    // TS: fields[index].read(this.values, () => draw(this.seed, this.node, index, at), noNote)
    pub fn field(&self, fields: &[Field], index: usize, at: i64) -> f64 {
        fields[index].read(self.values, || draw(self.seed, self.node, index, at), NoteContext::default())
    }

    /// Field `index` of `fields` for a note: a per-note field reads it, and a random one draws for its pitch.
    // TS: fields[index].read(this.values, () => draw(this.seed, this.node, index, note.pitch), note)
    pub fn note_field(&self, fields: &[Field], index: usize, note: NoteContext) -> f64 {
        fields[index].read(self.values, || draw(self.seed, self.node, index, i64::from(note.pitch)), note)
    }
}

/// A node: its kind and state, what feeds each of its ports (earlier nodes, merged), and its fields.
// TS: interface Node { kind: Kind; ports: number[][]; fields: Field[] }
pub struct Node {
    pub kind: Kind,
    pub ports: Vec<Vec<usize>>,
    pub fields: Vec<Field>,
}

impl Node {
    /// Turn a block's inputs (one sorted list per port) into the node's events, into `out`.
    // TS: KIND_PROCESS[this.kind.kind](this, inputs, context, out)
    pub fn process(&mut self, inputs: &[Vec<Timed>], context: &Context, out: &mut Vec<Timed>) {
        let fields = &self.fields;
        match &mut self.kind {
            // The chain puts the device's notes in the input node's output itself.
            Kind::Input => {}
            Kind::Clock(clock) => clock.process(&inputs[0], context.transport, context.field(fields, 0, 0), out),
            Kind::Pick(pick) => pick.process(&inputs[0], &inputs[1], fields, context, out),
            // TS: each copy is [interval, velocity, on], read for the note; a copy is numbered by its place
            Kind::Stack(map) => map.process(&inputs[0], out, |note, copy| {
                let on = context.note_field(fields, copy * 3 + 2, note) >= 0.5;
                let interval = context.note_field(fields, copy * 3, note).round() as i32;
                let velocity = note.velocity * context.note_field(fields, copy * 3 + 1, note) as f32;
                on.then_some((note.pitch + interval, velocity, copy as u8))
            }, fields.len() / 3),
            Kind::Transpose(map) => map.process(&inputs[0], out, |note, _| {
                Some((note.pitch + context.note_field(fields, 0, note).round() as i32, note.velocity, note.index))
            }, 1),
            // TS: notes.map(([offset, event]) => [offset, event.kind === "on" ? { ...event, velocity: clamp(event.velocity * scale(event)) } : event])
            Kind::Velocity => inputs[0].iter().for_each(|&(offset, event)| {
                let event = match event {
                    Event::On { note, velocity, length, index } => {
                        let scale = context.note_field(fields, 0, NoteContext::of(event)) as f32;
                        Event::On { note, velocity: (velocity * scale).clamp(0.0, 1.0), length, index }
                    }
                    other => other,
                };
                push(out, offset, event);
            }),
            // TS: notes.map(([offset, event]) => [offset, event.length ? { ...event, length: Math.max(1, Math.round(event.length * scale(event))) } : event])
            Kind::Length => inputs[0].iter().for_each(|&(offset, event)| {
                let event = match event {
                    Event::On { note, velocity, length: Some(length), index } => {
                        let scale = context.note_field(fields, 0, NoteContext::of(event)).max(0.0);
                        let length = (f64::from(length) * scale).round().max(1.0) as u32;
                        Event::On { note, velocity, length: Some(length), index }
                    }
                    other => other,
                };
                push(out, offset, event);
            }),
            Kind::Euclid => rhythm::euclid(&inputs[0], fields, context, out),
            Kind::Ratchet(ratchet) => ratchet.process(&inputs[0], fields, context, out),
            Kind::Order(order) => order.process(&inputs[0], fields, context, out),
            Kind::Delay(delay) => delay.process(&inputs[0], fields, context, out),
            Kind::Chance(chance) => chance.process(&inputs[0], fields, context, out),
        }
    }

    /// Let go of everything it holds: what each note became, what's held. Returns the notes it had
    /// sounding, as note offs at `offset`, into `out`.
    // TS: this.kind.clear?.(offset, out)
    pub fn clear(&mut self, offset: usize, out: &mut Vec<Timed>) {
        match &mut self.kind {
            Kind::Clock(clock) => clock.clear(),
            Kind::Pick(pick) => pick.clear(),
            Kind::Ratchet(ratchet) => ratchet.clear(),
            Kind::Stack(map) | Kind::Transpose(map) => map.clear(offset, out),
            Kind::Order(order) => order.clear(),
            Kind::Delay(delay) => delay.clear(offset, out),
            Kind::Chance(chance) => chance.clear(),
            Kind::Input | Kind::Velocity | Kind::Euclid | Kind::Length => {}
        }
    }
}

/// Push onto a full list does nothing: the list never grows past its room.
// TS: if (out.length < MAX_EVENTS) out.push([offset, event])
pub fn push(out: &mut Vec<Timed>, offset: usize, event: Event) {
    if out.len() < MAX_EVENTS {
        out.push((offset, event));
    }
}

/// The most notes one key (and index) becomes, across the ones it's moved to: a stack's copies, twice
/// over for a key that comes in with two indices.
const MAX_BECAME: usize = MAX_COPIES * 2;

/// Notes moved, and where each went: for every incoming key, the notes it became, so its note off lets
/// go of those.
// TS: class NoteMap { became: [fromIndex: number, note: number, index: number][][] = Array.from({ length: 128 }, () => []) }
pub struct NoteMap {
    /// By incoming key: how many notes it became, and each one's incoming index, note and own index.
    became: [(u8, [(u8, u8, u8); MAX_BECAME]); 128],
}

impl NoteMap {
    // TS: new NoteMap()  (an empty list for each of the 128 keys)
    pub fn new() -> Self {
        NoteMap { became: [(0, [(0, 0, 0); MAX_BECAME]); 128] }
    }

    /// Each note on becomes the notes `copy` makes of it (copies 0 to `copies`; None for one that's
    /// off): a pitch in 0..=127, a velocity and an index. Its note off, note offs for those. A note
    /// with a length becomes copies with the same length, and isn't remembered: it lets itself go.
    // TS: for (const [offset, event] of input) { ... }
    pub fn process(&mut self, input: &[Timed], out: &mut Vec<Timed>, copy: impl Fn(NoteContext, usize) -> Option<(i32, f32, u8)>, copies: usize) {
        for &(offset, event) in input {
            match event {
                Event::On { note, length, index, .. } => {
                    let key = note.clamp(0, 127) as usize;
                    // A key played again before its note off: let go of what it became first.
                    if length.is_none() {
                        self.release(key, index, offset, out);
                    }
                    for place in 0..copies.min(MAX_COPIES) {
                        let made = copy(NoteContext::of(event), place).filter(|&(moved, _, _)| (0..=127).contains(&moved));
                        let Some((moved, velocity, moved_index)) = made else { continue };
                        push(out, offset, Event::On { note: moved, velocity, length, index: moved_index });
                        let (count, notes) = &mut self.became[key];
                        if length.is_none() && usize::from(*count) < MAX_BECAME {
                            notes[usize::from(*count)] = (index, moved as u8, moved_index);
                            *count += 1;
                        }
                    }
                }
                Event::Off { note, index } => {
                    let key = note.clamp(0, 127) as usize;
                    // TS: if (!this.became[key].some(([from]) => from === index)) out.push([offset, event]) else this.release(key, index, offset, out)
                    let (count, notes) = &self.became[key];
                    if notes[..usize::from(*count)].iter().any(|&(from, _, _)| from == index) {
                        self.release(key, index, offset, out);
                    } else {
                        push(out, offset, event);
                    }
                }
                Event::Tick { .. } => {}
            }
        }
    }

    /// Note offs for what `key` became when it came in with `index`, and forget those.
    // TS: const [mine, rest] = partition(this.became[key], ([from]) => from === index); mine.forEach(... out.push(off)); this.became[key] = rest
    fn release(&mut self, key: usize, index: u8, offset: usize, out: &mut Vec<Timed>) {
        let (count, notes) = &mut self.became[key];
        let mut kept = 0;
        (0..usize::from(*count)).for_each(|at| {
            let (from, note, moved_index) = notes[at];
            if from == index {
                push(out, offset, Event::Off { note: i32::from(note), index: moved_index });
            } else {
                notes[kept] = notes[at];
                kept += 1;
            }
        });
        *count = kept as u8;
    }

    // TS: every key's notes let go
    fn clear(&mut self, offset: usize, out: &mut Vec<Timed>) {
        (0..128).for_each(|key| {
            let (count, notes) = &mut self.became[key];
            notes[..usize::from(*count)].iter().for_each(|&(_, note, index)| push(out, offset, Event::Off { note: i32::from(note), index }));
            *count = 0;
        });
    }
}

/// The notes a pick holds, and where its walk started.
// TS: class Pick { held: [note, velocity, played][] = []; played = 0; firstStep?: number }
pub struct Pick {
    /// What's held: note, velocity, and when it was played (a count), lowest note first.
    held: Vec<(i32, f32, u64)>,
    played: u64,
    /// The step the walk counts from: the first tick after the first note went down.
    first_step: Option<i64>,
}

/// The walk's directions, by the number its field gives; anything else walks up (0).
const DOWN: usize = 1;
const UP_DOWN: usize = 2;
const RANDOM: usize = 3;
const PLAYED: usize = 4;
const CHORD: usize = 5;

impl Pick {
    // TS: new Pick()
    pub fn new() -> Self {
        Pick { held: Vec::with_capacity(MAX_HELD), played: 0, first_step: None }
    }

    /// Hold the notes as they come and play one on each tick, both in sample order (a note landing
    /// with a tick goes first, so the tick hears it). Field: direction.
    // TS: process(notes, ticks, fields, context, out)
    fn process(&mut self, notes: &[Timed], ticks: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        let (mut next_note, mut next_tick) = (0, 0);
        // TS: while (a note or a tick is left) take whichever is first, a note when they tie
        while next_note < notes.len() || next_tick < ticks.len() {
            let note = notes.get(next_note).copied();
            let tick = ticks.get(next_tick).copied();
            // TS: const noteFirst = note && (!tick || note[0] <= tick[0])
            let note_first = match (note, tick) {
                (Some((offset, _)), Some((at, _))) => offset <= at,
                (note, _) => note.is_some(),
            };
            match (note, tick) {
                (Some((_, event)), _) if note_first => {
                    next_note += 1;
                    self.hold(event);
                }
                (_, Some((offset, Event::Tick { step, samples, level }))) => {
                    next_tick += 1;
                    self.play(offset, (step, samples, level), fields, context, out);
                }
                // Something on the ticks port that isn't a tick: words.rs only wires clocks there.
                _ => next_tick += 1,
            }
        }
    }

    /// Hold a note, or let it go. A note with a length isn't held: it has no note off to come.
    // TS: on && !length ? insert by pitch : off ? remove : nothing
    fn hold(&mut self, event: Event) {
        match event {
            Event::On { note, velocity, length: None, .. } => {
                if self.held.is_empty() {
                    self.first_step = None;
                }
                if self.held.len() < MAX_HELD && !self.held.iter().any(|&(held, _, _)| held == note) {
                    let at = self.held.iter().position(|&(held, _, _)| held > note).unwrap_or(self.held.len());
                    self.held.insert(at, (note, velocity, self.played));
                    self.played += 1;
                }
            }
            Event::Off { note, .. } => self.held.retain(|&(held, _, _)| held != note),
            _ => {}
        }
    }

    /// Play a tick's note (`step`, `samples` long, at `level`), if anything's held, for the step, at
    /// the loudest held velocity times the level. A chord plays every held note. Each note is numbered
    /// by its place in what's held, lowest first.
    // TS: const note = held[index of step, in the direction's order]; out.push([offset, on(note, loudest * level, samples)])
    // `(step, samples, level): (i64, f64, f32)` takes a tuple and names its parts, as TS's `[step, samples, level]: [...]`.
    fn play(&mut self, offset: usize, (step, samples, level): (i64, f64, f32), fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        if self.held.is_empty() {
            return;
        }
        // TS: const velocity = Math.max(...held.map(([, velocity]) => velocity)) * level
        // `fold(0.0, f32::max)` is a reduce starting at 0 that keeps the larger each time.
        let velocity = self.held.iter().map(|&(_, velocity, _)| velocity).fold(0.0, f32::max) * level;
        let first = *self.first_step.get_or_insert(step);
        let direction = context.field(fields, 0, step).round() as usize;
        let length = samples.round().max(1.0) as u32;
        let count = self.held.len();
        // TS: const on = (note: number, index: number) => ({ kind: "on", note, velocity, length, index })
        let on = |note: i32, index: usize| Event::On { note, velocity, length: Some(length), index: index.min(255) as u8 };
        // TS: if (direction === CHORD) { held.forEach(([note], index) => out.push([offset, on(note, index)])); return }
        if direction == CHORD {
            self.held.iter().enumerate().for_each(|(index, &(note, _, _))| push(out, offset, on(note, index)));
            return;
        }
        let walked = (step - first).max(0) as usize;
        // Which of the `count` notes (held by pitch) this step plays.
        // TS: { up: walked % count, [DOWN]: count - 1 - walked % count, [UP_DOWN]: bounce, [RANDOM]: draw, [PLAYED]: by when played }
        let index = match direction {
            DOWN => count - 1 - walked % count,
            UP_DOWN if count > 1 => {
                let period = 2 * count - 2;
                let at = walked % period;
                if at < count { at } else { period - at }
            }
            RANDOM => ((draw(context.seed, context.node, 0, step) * count as f64) as usize).min(count - 1),
            _ => walked % count,
        };
        let (note, _, _) = if direction == PLAYED {
            // The `index`th note by when it was played: count those played before each.
            let rank = |&(_, _, when): &(i32, f32, u64)| self.held.iter().filter(|&&(_, _, other)| other < when).count();
            *self.held.iter().find(|held| rank(held) == index).unwrap_or(&self.held[index])
        } else {
            self.held[index]
        };
        push(out, offset, on(note, index));
    }

    // TS: this.held = []; this.firstStep = undefined
    fn clear(&mut self) {
        self.held.clear();
        self.first_step = None;
    }
}
