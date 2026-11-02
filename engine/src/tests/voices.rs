//! The voice allocator on its own (router/voices.rs), with a stand-in engine: a slot sounds from its
//! note on until `finish`es it. Playing through the bank, zones and shaping included, is tested from
//! TypeScript (test/engineBank.test.ts), against engine.wasm.

use crate::router::{LegatoOff, VoiceAllocator};
use std::cell::RefCell;
use std::collections::HashSet;

/// An allocator and the slots its stand-in engine has sounding.
// TS: { allocated: new VoiceAllocator(slots, voices), busy: new Set<number>() }
struct Allocator {
    allocated: VoiceAllocator,
    // A RefCell, so the `sounding` closure can read it while `allocated` is borrowed to change.
    busy: RefCell<HashSet<usize>>,
}

impl Allocator {
    // TS: static create(slots, voices) { return { allocated: new VoiceAllocator(slots, voices), busy: new Set() } }
    fn new(slots: usize, voices: usize) -> Self {
        Allocator { allocated: VoiceAllocator::new(slots, voices), busy: RefCell::new(HashSet::new()) }
    }

    /// Play `note` at `time`: the slot it took, and the slot cut for it.
    // TS: const slot = allocated.noteOn(note, 1, time, (slot) => busy.has(slot)); busy.add(slot); return [slot, allocated.cut];
    fn play(&mut self, note: i32, time: u64) -> (usize, Option<usize>) {
        // `busy.borrow()` reads the set inside the RefCell; `borrow_mut()` lends it to change.
        let busy = &self.busy;
        let slot = self.allocated.note_on(note, 1.0, time, |slot| busy.borrow().contains(&slot));
        busy.borrow_mut().insert(slot);
        (slot, self.allocated.cut)
    }

    // TS: finish(slot) { busy.delete(slot) }
    fn finish(&mut self, slot: usize) {
        self.busy.borrow_mut().remove(&slot);
    }
}

#[test]
fn takes_free_slots_and_cuts_a_sounding_notes_copy_to_start_it_again() {
    let mut allocator = Allocator::new(4, 2);
    assert_eq!(allocator.play(60, 0), (0, None));
    assert_eq!(allocator.play(64, 1), (1, None));
    // Slot 0 fades out while the note starts again in a spare.
    assert_eq!(allocator.play(60, 2), (2, Some(0)));
}

#[test]
fn past_its_voices_cuts_the_one_released_longest_ago_then_the_oldest_held() {
    let mut allocator = Allocator::new(5, 3);
    // TS: [60, 62, 64].forEach((note, time) => play(note, time)). `zip(0..)` pairs each note with 0, 1, 2.
    [60, 62, 64].into_iter().zip(0..).for_each(|(note, time)| {
        allocator.play(note, time);
    });
    allocator.allocated.note_off(64, 3);
    allocator.allocated.note_off(62, 4);
    assert_eq!(allocator.play(65, 5), (3, Some(2)));
    assert_eq!(allocator.play(67, 6), (4, Some(1)));
    // Every slot is busy or fading: the one cut longest ago is taken over.
    assert_eq!(allocator.play(69, 7), (1, Some(0)));
}

#[test]
fn uses_a_slot_again_once_its_cut_has_finished() {
    let mut allocator = Allocator::new(3, 1);
    allocator.play(60, 0);
    assert_eq!(allocator.play(62, 1), (1, Some(0)));
    allocator.finish(0);
    assert_eq!(allocator.play(64, 2), (0, Some(1)));
}

#[test]
fn ignores_the_note_off_of_a_cut_note() {
    let mut allocator = Allocator::new(2, 1);
    allocator.play(60, 0);
    allocator.play(62, 1);
    assert_eq!(allocator.allocated.note_off(60, 2), None);
    assert_eq!(allocator.allocated.note_off(62, 2), Some(1));
}

#[test]
fn keeps_the_held_notes_with_their_velocities() {
    let mut allocator = Allocator::new(4, 4);
    // `|_| false` is `() => false`: nothing is sounding.
    allocator.allocated.note_on(60, 0.5, 0, |_| false);
    allocator.allocated.note_on(64, 0.25, 1, |_| false);
    allocator.allocated.note_off(60, 2);
    assert_eq!(allocator.allocated.held_notes(), vec![(64, 0.25)]);
}

/// Legato: a note with a key down moves its voice; letting go walks back through the keys still down.
#[test]
fn legato_moves_the_sounding_voice_and_lets_go_back_to_the_key_before() {
    let mut allocator = Allocator::new(4, 4);
    // TS: no key down yet, so the first note starts a voice.
    assert_eq!(allocator.allocated.legato_on(60, 1.0), None);
    let (slot, _) = allocator.play(60, 0);
    allocator.allocated.legato_started(60, 1.0);
    // Each next key moves the same voice.
    assert_eq!(allocator.allocated.legato_on(64, 0.5), Some(slot));
    assert_eq!(allocator.allocated.legato_on(67, 0.7), Some(slot));
    // Letting go of a key that isn't sounding changes nothing; the sounding one goes back a key.
    assert_eq!(allocator.allocated.legato_off(64), LegatoOff::Kept);
    assert_eq!(allocator.allocated.legato_off(67), LegatoOff::Back { slot, note: 60, velocity: 1.0 });
    // The last key releases the voice as usual, by its note now.
    assert_eq!(allocator.allocated.legato_off(60), LegatoOff::Release);
    assert_eq!(allocator.allocated.note_off(60, 1), Some(slot));
    // With every key up, the next note starts a voice again.
    assert_eq!(allocator.allocated.legato_on(62, 1.0), None);
}

#[test]
fn legato_moves_a_key_struck_again_to_the_end() {
    let mut allocator = Allocator::new(2, 2);
    let (slot, _) = allocator.play(60, 0);
    allocator.allocated.legato_started(60, 1.0);
    allocator.allocated.legato_on(62, 1.0);
    assert_eq!(allocator.allocated.legato_on(60, 1.0), Some(slot));
    assert_eq!(allocator.allocated.legato_off(60), LegatoOff::Back { slot, note: 62, velocity: 1.0 });
}

#[test]
fn legato_forgets_the_keys_when_every_note_lets_go() {
    let mut allocator = Allocator::new(2, 2);
    let (slot, _) = allocator.play(60, 0);
    allocator.allocated.legato_started(60, 1.0);
    allocator.allocated.legato_on(62, 1.0);
    allocator.allocated.release_slot(slot, 1);
    assert_eq!(allocator.allocated.legato_on(64, 1.0), None);
}
