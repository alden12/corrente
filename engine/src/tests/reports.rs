//! What the engine reports and promises: rendering allocates nothing, and each track's peaks,
//! silence, latency and block meters read back.

use super::*;
use crate::plan::SIGNAL_VELOCITY;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

/// Counts the allocations each thread makes, so a test can check rendering makes none.
// No TS equivalent: a Rust program can choose its memory allocator. This one, only in the tests,
// counts each request and hands it on to the system's. `unsafe impl` because an allocator makes
// promises the compiler can't check (that the memory it returns is valid), and `unsafe { ... }`
// marks the calls into the system's: the only unsafe code in the engine, and it is test-only.
struct CountingAllocator;

// Per thread, since tests run in parallel threads. `Cell` is a value that can be changed through a
// shared reference: one number, so no loan rules to break. `const { ... }` sets it up without
// allocating, which matters inside an allocator.
thread_local! {
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // `try_with` rather than `with`: while a thread shuts down, its count may already be gone.
        let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }
}

// TS: no equivalent. Makes this the allocator for the whole test program.
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// How many allocations `run` makes on this thread.
// TS: const before = count; run(); return count - before;
// `Cell::get` names the method as a function, for `with` to call on the cell.
fn allocations_during(run: impl FnOnce()) -> usize {
    let before = ALLOCATIONS.with(Cell::get);
    run();
    ALLOCATIONS.with(Cell::get) - before
}

#[test]
fn rendering_allocates_nothing() {
    // A plan with a bit of everything: a shared loop, filtered and enveloped voices panned in stereo,
    // an echo on the voice sum run in chunks, and a meter.
    let plan = PlanBuilder::new()
        .params(1)
        .node_in(PRE, kind("add"), vec![constant(1.0), previous(0)], vec![])
        .step_in(PRE, SAMPLE_LOOP, vec![0])
        .node(kind("saw"), vec![voice(0)], vec![])
        .node(kind("ladder"), vec![buffer(0)], vec![param(0), constant(0.5)])
        .node(kind("adsr"), vec![voice(SIGNAL_GATE)], vec![constant(0.01), constant(0.1), constant(0.7), constant(0.2)])
        .node(kind("mul"), vec![buffer(1), buffer(2)], vec![])
        .node(kind("pan"), vec![buffer(3)], vec![constant(0.3)])
        .step(NODE, vec![0])
        .step(NODE, vec![1])
        .step(NODE, vec![2])
        .step(NODE, vec![3])
        .step(NODE, vec![4])
        .voice_out(vec![port(4, 0), port(4, 1)])
        .node_in(POST, kind("add"), vec![voice_sum(0), buffer(2)], vec![])
        .node_in(POST, KIND_DELAY, vec![buffer(0), constant(100.0)], vec![])
        .node_in(POST, kind("mul"), vec![buffer(1), constant(0.3)], vec![])
        .node_in(POST, kind("meter"), vec![buffer(0)], vec![])
        .step_in(POST, CHUNK_LOOP, vec![1, 2, 0])
        .step_in(POST, NODE, vec![3])
        .track_out(vec![buffer(3)]);
    let mut engine = plan.loaded();
    engine.init_param(0, 0, 2000.0);
    engine.note_on(0, 0, 0, 220.0, 1.0);
    render(&mut engine, 4);
    // Everything that happens while playing: blocks, param moves, notes on and off, reading reports.
    let count = allocations_during(|| {
        (0..16).for_each(|block| {
            engine.set_param(0, 0, 1000.0 + block as f32 * 100.0);
            engine.note_on(0, 1, 5, 330.0, 0.8);
            engine.note_off(0, 0, 3);
            engine.process();
            let _ = (engine.peak(0, 0), engine.silent(0), engine.meter(0, POST, 3, 0));
        });
    });
    assert_eq!(count, 0);
    // The counter does count: one small list is one allocation. `black_box` stops the optimizer
    // seeing the list is never used and removing it.
    assert_eq!(allocations_during(|| drop(std::hint::black_box(vec![0u8; 16]))), 1);
    // And the plan really played.
    assert!(engine.peak(0, 0).unwrap() > 0.01);
}

#[test]
fn a_track_reports_its_peaks_and_when_it_falls_silent() {
    let plan = PlanBuilder::new()
        .node(kind("mul"), vec![voice(SIGNAL_GATE), constant(0.5)], vec![])
        .step(NODE, vec![0])
        .out(buffer(0));
    let mut engine = plan.loaded();
    engine.process();
    assert_eq!((engine.peak(0, 0), engine.silent(0)), (Some(0.0), Some(true)));
    engine.note_on(0, 0, 0, 440.0, 1.0);
    engine.process();
    assert_eq!((engine.peak(0, 1), engine.silent(0)), (Some(0.5), Some(false)));
    // The gate closes at once, so the voice finishes in the same block and the track falls silent.
    engine.note_off(0, 0, 0);
    engine.process();
    assert_eq!(engine.silent(0), Some(true));
    // A track or channel that doesn't exist.
    assert_eq!((engine.peak(1, 0), engine.peak(0, 2), engine.silent(1)), (None, None, None));
}

#[test]
fn a_track_reports_the_latency_its_plan_declares() {
    let plan = PlanBuilder::new().latency(64).node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![]).step(NODE, vec![0]);
    let engine = plan.loaded();
    assert_eq!(engine.latency(0), Some(64));
    assert_eq!(engine.latency(1), None);
}

#[test]
fn block_meters_read_back_from_each_section() {
    // A meter on the voices summed, after them; and one in each voice, on its velocity.
    let plan = PlanBuilder::new()
        .node(kind("meter"), vec![voice(SIGNAL_VELOCITY)], vec![])
        .step(NODE, vec![0])
        .out(buffer(0))
        .node_in(POST, kind("meter"), vec![voice_sum(0)], vec![])
        .step_in(POST, NODE, vec![0])
        .track_out(vec![buffer(0)]);
    let mut engine = plan.loaded();
    engine.process();
    // No voice sounding: the voice section's meter reads 0.
    assert_eq!(engine.meter(0, VOICE, 0, 0), Some(0.0));
    engine.note_on(0, 0, 0, 440.0, 0.3);
    engine.note_on(0, 1, 0, 440.0, 0.8);
    engine.process();
    // The loudest of the voices.
    assert_eq!(engine.meter(0, VOICE, 0, 0), Some(0.8));
    // Each voice plays its velocity, scaled by its velocity on the way into the sum: 0.09 + 0.64.
    assert!((engine.meter(0, POST, 0, 0).unwrap() - 0.73).abs() < 1e-6);
    // Things that aren't there: a second meter, a node, a section.
    assert_eq!(engine.meter(0, POST, 0, 1), None);
    assert_eq!(engine.meter(0, POST, 1, 0), None);
    assert_eq!(engine.meter(0, 3, 0, 0), None);
}
