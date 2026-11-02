//! **slide** (INST-32): each note on becomes a run from the note before to it, so a `delay` by index
//! after it plays a glissando. The notes between the two, one a semitone (or one a degree of the song's
//! key) apart, each last `beats`; the note itself comes last, held as its key is. Each is numbered by
//! its place in the run from 0, and the note's off by its, so the delay lets go of the right one.
//!
//! With `when` on legato, only a note played while another key is still down slides; on always, every
//! note slides from the last one played. The first note, and one played again, just play.
//!
//! Rust notes, for reading this file:
//! - `u128` is a 128-bit number, used here as 128 flags: bit n is set while key n is down.

use super::nodes::{Context, push};
use super::pitch::in_key;
use super::{Event, Field, Timed};

/// `scale`'s choices, by the number the field gives: chromatic (0), or in the song's key.
const IN_KEY: usize = 1;
/// `when`'s choices: only while a key is down (0), or always.
const ALWAYS: usize = 1;
/// The most notes a run passes through: two octaves, so one jump can't flood the block.
const MAX_RUN: usize = 24;

// TS: class Slide { last?: number; down = 0n; indices = new Array(128).fill(0) }
pub struct Slide {
    /// The last note played, which the next slides from.
    last: Option<i32>,
    /// The keys down, as bits.
    down: u128,
    /// By note: the index its note on was given, its place in the run, for its note off.
    indices: [u8; 128],
}

// TS: Math.max(0, Math.min(127, note))
fn key(note: i32) -> usize {
    note.clamp(0, 127) as usize
}

impl Slide {
    // TS: new Slide()
    pub fn new() -> Self {
        Slide { last: None, down: 0, indices: [0; 128] }
    }

    /// Play each note on as a run from the last note. Fields: beats, scale, when.
    // TS: for (const [offset, event] of notes) on: push the passing notes then the note; off: its index
    pub fn process(&mut self, notes: &[Timed], fields: &[Field], context: &Context, out: &mut Vec<Timed>) {
        let per_sample = context.transport.per_sample.max(1e-12);
        let length = (context.field(fields, 0, 0).max(0.0) / per_sample).round().max(1.0) as u32;
        let in_key_only = context.field(fields, 1, 0).round() as usize == IN_KEY;
        let always = context.field(fields, 2, 0).round() as usize == ALWAYS;
        for &(offset, event) in notes {
            match event {
                Event::On { note, velocity, .. } => {
                    // TS: const from = always || this.down !== 0n ? this.last : undefined
                    let from = if always || self.down != 0 { self.last } else { None };
                    let mut index = 0u8;
                    if let Some(from) = from {
                        // The notes strictly between, nearest the last first, in the key if asked.
                        // TS: range(from, note).slice(1).filter(inKey).slice(0, MAX_RUN).forEach(...)
                        let step = (note - from).signum();
                        let passing = (1..(note - from).abs())
                            .map(|distance| from + step * distance)
                            .filter(|&pitch| !in_key_only || in_key(context.transport.key, pitch))
                            .take(MAX_RUN);
                        for pitch in passing {
                            push(out, offset, Event::On { note: pitch, velocity, length: Some(length), index });
                            index += 1;
                        }
                    }
                    self.indices[key(note)] = index;
                    self.last = Some(note);
                    self.down |= 1u128 << key(note);
                    push(out, offset, Event::On { note, velocity, length: None, index });
                }
                Event::Off { note, .. } => {
                    self.down &= !(1u128 << key(note));
                    push(out, offset, Event::Off { note, index: self.indices[key(note)] });
                }
                Event::Tick { .. } => {}
            }
        }
    }

    // TS: this.last = undefined; this.down = 0n
    pub fn clear(&mut self) {
        self.last = None;
        self.down = 0;
    }
}
