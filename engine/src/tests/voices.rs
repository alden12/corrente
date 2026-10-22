//! The voice allocator on its own (router/voices.rs), with a stand-in engine: a slot sounds from its
//! note on until `finish`es it. Playing through the bank, zones and shaping included, is tested from
//! TypeScript (test/engineBank.test.ts), against engine.wasm.

use crate::router::VoiceAllocator;
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
    fn new(slots: usize, voices: usize) -> Self {
        Allocator { allocated: VoiceAllocator::new(slots, voices), busy: RefCell::new(HashSet::new()) }
    }

    /// Play `note` at `time`: the slot it took, and the slot cut for it.
    // TS: const slot = allocated.noteOn(note, 1, time, (slot) => busy.has(slot)); busy.add(slot); return [slot, allocated.cut];
    fn play(&mut self, note: i32, time: u64) -> (usize, Option<usize>) {
        let busy = &self.busy;
        let slot = self.allocated.note_on(note, 1.0, time, |slot| busy.borrow().contains(&slot));
        busy.borrow_mut().insert(slot);
        (slot, self.allocated.cut)
    }

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
    allocator.allocated.note_on(60, 0.5, 0, |_| false);
    allocator.allocated.note_on(64, 0.25, 1, |_| false);
    allocator.allocated.note_off(60, 2);
    assert_eq!(allocator.allocated.held_notes(), vec![(64, 0.25)]);
}
