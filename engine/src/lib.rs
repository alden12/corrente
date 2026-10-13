//! Corrente's audio engine (INST-36): Faust blocks compiled to Rust, run by a router that follows a
//! plan built from a device's definition. This file is the module's surface: the functions the
//! browser calls, all named `eng_*`.
//!
//! - faust.rs is what the Faust blocks have in common; compile.ts generates the blocks themselves into gen/.
//! - plan/ reads and checks a plan.
//! - router/ runs a bank of tracks, each following its own plan.
//! - tests/ are the Rust tests, by topic.
//!
//! The exports are thin: each borrows the one engine and calls a method on it. Calls name the track
//! they mean; a track or voice slot that doesn't exist is ignored. WebAssembly here is
//! single-threaded, so the engine lives in a thread-local cell rather than a global variable.
//!
//! Rust notes, for reading this file:
//! - `mod faust;` pulls in src/faust.rs as a module.
//! - `#[unsafe(no_mangle)] pub extern "C"` exports a function under its own name with a calling
//!   convention JavaScript can call. The `unsafe` marks that the name is exported as is, and so must
//!   not clash with anything else: nothing in the body is unsafe.
//! - `i32` is a 32-bit integer, what WebAssembly passes across; `usize` is Rust's index type, and
//!   `usize::try_from(x)` converts with a check (a negative number is an error, not a huge index).
//! - Ownership, which TS has no version of: every value has exactly one owner, and is freed when its
//!   owner goes away (no garbage collector). Passing a value to a function moves it there, and the
//!   caller can't use it after, unless its type is `Copy` (numbers and small structs marked so) or
//!   the caller lends it instead: `&value` lends it read-only, `&mut value` lends it writable, and
//!   only one writable loan can exist at a time.
//! - `RefCell` lets the engine be borrowed mutably from a function that doesn't own it, with the
//!   one-writer rule checked when it runs rather than when it compiles.

mod faust;
mod plan;
mod router;

use std::cell::RefCell;

use router::Engine;

// TS: let ENGINE = new Engine(); let ALLOCATIONS: Int32Array[] = [];  (module-level state)
// Rust won't let plain globals be changed freely (two threads could race), so mutable state goes in
// `thread_local!`, one copy per thread (there is only one here), wrapped in a RefCell so it can be
// borrowed writable on demand. `const { ... }` builds the starting value at compile time.
// `Box<[i32]>` is a fixed-length array of i32s on the heap, like an Int32Array.
thread_local! {
    static ENGINE: RefCell<Engine> = const { RefCell::new(Engine::new()) };
    /// Memory handed to JS by eng_malloc, kept until eng_free. Words, so JS can view it as int32s.
    static ALLOCATIONS: RefCell<Vec<Box<[i32]>>> = const { RefCell::new(Vec::new()) };
}

// TS: function withEngine<R>(run: (engine: Engine) => R): R { return run(ENGINE) }
// `<R>` is a generic, as in TS. `impl FnOnce(&mut Engine) -> R` is a function argument called at
// most once, given the engine writable. `with_borrow_mut` takes the writable loan from the RefCell,
// runs `run` with it, and gives it back.
fn with_engine<R>(run: impl FnOnce(&mut Engine) -> R) -> R {
    ENGINE.with_borrow_mut(run)
}

/// Called once when the module starts. Nothing to do: memory starts small and grows only while a
/// plan loads (eng_init and eng_load), never while rendering (a test checks rendering allocates
/// nothing). Growing replaces JS's ArrayBuffer of the memory, so JS makes its views again after
/// those two calls; the addresses eng_input and eng_output give stay the same.
#[unsafe(no_mangle)]
pub extern "C" fn _initialize() {}

/// Memory for JS to write a plan into. Freed by eng_free.
// TS:
//   function eng_malloc(bytes: number): number {
//     const allocation = new Int32Array(Math.ceil(Math.max(bytes, 0) / 4));
//     ALLOCATIONS.push(allocation);
//     return addressOf(allocation);
//   }
// `*mut i32` is a raw pointer, a plain memory address with no ownership: here, what JS needs to find
// the memory. `.unwrap_or(0)` takes a Result's value, or 0 if it failed. `vec![0; words]` is an
// array of `words` zeros; `.into_boxed_slice()` fixes its length. Pushing it into ALLOCATIONS
// moves it there, which keeps it alive after this function returns.
#[unsafe(no_mangle)]
pub extern "C" fn eng_malloc(bytes: i32) -> *mut i32 {
    let words = usize::try_from(bytes).unwrap_or(0).div_ceil(4);
    let mut allocation = vec![0; words].into_boxed_slice();
    let pointer = allocation.as_mut_ptr();
    ALLOCATIONS.with_borrow_mut(|allocations| allocations.push(allocation));
    pointer
}

// TS: ALLOCATIONS = ALLOCATIONS.filter((allocation) => addressOf(allocation) !== pointer)
// `retain` is an in-place filter. The ones it removes are freed, since nothing owns them any more.
// `.cast_const()` turns the writable pointer into a read-only one so the two compare.
#[unsafe(no_mangle)]
pub extern "C" fn eng_free(pointer: *mut i32) {
    ALLOCATIONS.with_borrow_mut(|allocations| {
        allocations.retain(|allocation| allocation.as_ptr() != pointer.cast_const());
    });
}

// TS: const index = (value: number) => (value >= 0 ? value : undefined)
// Every export takes i32s from JS; this turns one into an index, or None if it is negative.
fn index(value: i32) -> Option<usize> {
    usize::try_from(value).ok()
}

/// Set the sample rate and how many tracks the bank has (each silent until a plan loads). Returns the
/// number of block kinds.
// TS: return withEngine((engine) => engine.init(rate, index(tracks) ?? 0))
#[unsafe(no_mangle)]
pub extern "C" fn eng_init(rate: i32, tracks: i32) -> i32 {
    with_engine(|engine| engine.init(rate, index(tracks).unwrap_or(0)))
}

/// Load a plan into a track, from memory eng_malloc handed out. Returns 0, or -1 for a bad plan or
/// track and -2 for a plan of the wrong length (the track is unchanged either way).
// TS:
//   const allocation = ALLOCATIONS.find((allocation) => addressOf(allocation) === pointer);
//   const words = allocation && length >= 0 && length <= allocation.length ? allocation.subarray(0, length) : undefined;
//   if (!words) return REJECTED;
//   const parsed = parse(words);  // a plan, or an error code
//   if (isErrorCode(parsed)) return parsed;
//   return withEngine((engine) => engine.load(track, parsed)) ? 0 : REJECTED;
// Inside the closure, `?` works on Options: a None returns None from the closure straight away.
// `allocation.get(..n)` is the first n words, or None if there aren't that many.
// The `match` on the pair then handles the outcomes: `(Some(Ok(new_plan)), Some(track))` pulls the
// plan out of both wrappers when the track index is valid too, `(Some(Err(code)), _)` is the
// parser's error code (`_` matches anything), and the last `_` is everything else.
#[unsafe(no_mangle)]
pub extern "C" fn eng_load(track: i32, pointer: *const i32, length: i32) -> i32 {
    // Reading the plan through its allocation, not the raw pointer, keeps this safe: a pointer the
    // engine didn't hand out is rejected rather than read.
    let parsed = ALLOCATIONS.with_borrow(|allocations| {
        let allocation = allocations.iter().find(|allocation| allocation.as_ptr() == pointer)?;
        let words = allocation.get(..index(length)?)?;
        Some(plan::parse(words))
    });
    match (parsed, index(track)) {
        (Some(Ok(new_plan)), Some(track)) => {
            if with_engine(|engine| engine.load(track, new_plan)) { 0 } else { plan::REJECTED }
        }
        (Some(Err(code)), _) => code,
        _ => plan::REJECTED,
    }
}

/// Set a track param's value; it ramps there over the next block.
// TS: if (track >= 0 && source >= 0) withEngine((engine) => engine.setParam(track, source, value));
// `if let (Some(a), Some(b)) = (x, y)` runs the block only if both are present, naming them: a
// one-case `match` on a pair.
#[unsafe(no_mangle)]
pub extern "C" fn eng_set_param(track: i32, source: i32, value: f32) {
    if let (Some(track), Some(source)) = (index(track), index(source)) {
        with_engine(|engine| engine.set_param(track, source, value));
    }
}

/// Jump a track param to a value with no ramp (its starting value).
// TS: if (track >= 0 && source >= 0) withEngine((engine) => engine.initParam(track, source, value));
#[unsafe(no_mangle)]
pub extern "C" fn eng_init_param(track: i32, source: i32, value: f32) {
    if let (Some(track), Some(source)) = (index(track), index(source)) {
        with_engine(|engine| engine.init_param(track, source, value));
    }
}

/// Start a note in a track's voice slot, `offset` samples into the coming block.
// TS: if (track >= 0 && slot >= 0) withEngine((engine) => engine.noteOn(track, slot, offset, frequency, velocity));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_on(track: i32, slot: i32, offset: i32, frequency: f32, velocity: f32) {
    if let (Some(track), Some(slot)) = (index(track), index(slot)) {
        with_engine(|engine| engine.note_on(track, slot, offset, frequency, velocity));
    }
}

/// Release the note in a track's voice slot, `offset` samples into the coming block.
// TS: if (track >= 0 && slot >= 0) withEngine((engine) => engine.noteOff(track, slot, offset));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_off(track: i32, slot: i32, offset: i32) {
    if let (Some(track), Some(slot)) = (index(track), index(slot)) {
        with_engine(|engine| engine.note_off(track, slot, offset));
    }
}

/// Fade the voice in a track's slot out over a block from `offset`, then free the slot: how JS steals
/// a voice without a click.
// TS: if (track >= 0 && slot >= 0) withEngine((engine) => engine.cut(track, slot, offset));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_cut(track: i32, slot: i32, offset: i32) {
    if let (Some(track), Some(slot)) = (index(track), index(slot)) {
        with_engine(|engine| engine.cut(track, slot, offset));
    }
}

/// How many voice slots a track has: its plan's voices and a few spares, which JS allocates from.
/// -1 if there is no such track.
// TS: return withEngine((engine) => engine.voiceSlots(track)) ?? -1
// `.and_then(f)` chains a lookup that may come up empty; `.map_or(-1, f)` gives -1 for None.
#[unsafe(no_mangle)]
pub extern "C" fn eng_voice_slots(track: i32) -> i32 {
    index(track).and_then(|track| with_engine(|engine| engine.voice_slots(track))).map_or(-1, |slots| slots as i32)
}

/// 1 if the track's voice slot is sounding (including its release), 0 if it is free.
// TS: return Number(track >= 0 && slot >= 0 && withEngine((engine) => engine.voiceActive(track, slot)))
// `.is_some_and(f)`: false if missing, else f(value). `as i32` turns a bool into 0 or 1.
#[unsafe(no_mangle)]
pub extern "C" fn eng_voice_active(track: i32, slot: i32) -> i32 {
    let active = index(track).zip(index(slot)).is_some_and(|(track, slot)| with_engine(|engine| engine.voice_active(track, slot)));
    active as i32
}

/// Where to write a track's audio input channel (128 samples) before the next eng_process, or 0 if
/// there is no such track or channel. The address stays put, so JS views it once.
// TS: return addressOf(withEngine((engine) => engine.inputMut(track, channel))) ?? 0
// `*mut f32` is a raw pointer, a plain address with no ownership: what JS needs to find the memory.
// `.map_or(default, f)`: f(value) if there is one, else the default; `std::ptr::null_mut()` is 0.
#[unsafe(no_mangle)]
pub extern "C" fn eng_input(track: i32, channel: i32) -> *mut f32 {
    let (Some(track), Some(channel)) = (index(track), index(channel)) else { return std::ptr::null_mut() };
    with_engine(|engine| engine.input_mut(track, channel).map_or(std::ptr::null_mut(), |input| input.as_mut_ptr()))
}

/// Where a track's output channel (128 samples) is after eng_process, or 0 if there is no such
/// track or channel. The address stays put, so JS views it once.
// TS: return addressOf(withEngine((engine) => engine.output(track, channel))) ?? 0
// `std::ptr::null()` is the read-only null; `.as_ptr()` is the array's address.
#[unsafe(no_mangle)]
pub extern "C" fn eng_output(track: i32, channel: i32) -> *const f32 {
    let (Some(track), Some(channel)) = (index(track), index(channel)) else { return std::ptr::null() };
    with_engine(|engine| engine.output(track, channel).map_or(std::ptr::null(), |output| output.as_ptr()))
}

/// Render one block of every track. Their outputs are then at the addresses eng_output gave.
// TS: withEngine((engine) => engine.process())
#[unsafe(no_mangle)]
pub extern "C" fn eng_process() {
    with_engine(|engine| engine.process());
}

/// How many kinds of block the engine has. Kinds are numbered 0 to count - 1, by sorted name.
// TS: export function eng_block_count(): number { return faust.COUNT }
// `as i32` converts between number types (it would wrap silently on overflow; fine for a count).
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_count() -> i32 {
    faust::COUNT as i32
}

/// How many audio inputs a kind takes, or -1 if there is no such kind.
// TS: return faust.inputs(kind) ?? -1
// `.map_or(default, f)` on an Option: f(value) if there is one, else the default.
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_inputs(kind: i32) -> i32 {
    faust::inputs(kind).map_or(-1, |count| count as i32)
}

/// How many outputs a kind writes, or -1 if there is no such kind.
// TS: return faust.outputs(kind) ?? -1
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_outputs(kind: i32) -> i32 {
    faust::outputs(kind).map_or(-1, |count| count as i32)
}

/// A kind's controls and meters, by building one to ask (the only way to know, so this also proves
/// every block can be built). None if there is no such kind.
// TS: return kind >= 0 && kind < faust.COUNT ? faust.ports(faust.create(kind)) : undefined
// `.filter(f)` on an Option keeps the value only if f says so. `&*faust::create(kind)`: create
// returns a Box (an owned block); `*` reaches the block inside and `&` lends it to `ports`. The box
// is dropped, freeing the block, at the end of the expression.
fn block_ports(kind: i32) -> Option<faust::Ports> {
    index(kind).filter(|&kind| kind < faust::COUNT).map(|kind| faust::ports(&*faust::create(kind)))
}

/// How many control inputs (Faust sliders) a kind has, or -1 if there is no such kind.
// TS: return blockPorts(kind)?.controls.length ?? -1
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_controls(kind: i32) -> i32 {
    block_ports(kind).map_or(-1, |ports| ports.controls.len() as i32)
}

/// How many meters (Faust bargraphs) a kind has, or -1 if there is no such kind.
// TS: return blockPorts(kind)?.meters.length ?? -1
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_meters(kind: i32) -> i32 {
    block_ports(kind).map_or(-1, |ports| ports.meters.len() as i32)
}

/// The loudest sample in a track's output channel last block, or -1 if there is no such track or
/// channel. For level meters.
// TS: return withEngine((engine) => engine.peak(track, channel)) ?? -1
// `.zip(other)` on two Options: Some((a, b)) if both are there. `.and_then(f)` chains a lookup that
// may come up empty.
#[unsafe(no_mangle)]
pub extern "C" fn eng_track_peak(track: i32, channel: i32) -> f32 {
    let found = index(track).zip(index(channel)).and_then(|(track, channel)| with_engine(|engine| engine.peak(track, channel)));
    found.unwrap_or(-1.0)
}

/// 1 if a track was silent last block (no voice sounding, nothing out), 0 if not, -1 if there is no
/// such track.
// TS: const silent = withEngine((engine) => engine.silent(track)); return silent === undefined ? -1 : Number(silent)
#[unsafe(no_mangle)]
pub extern "C" fn eng_track_silent(track: i32) -> i32 {
    index(track).and_then(|track| with_engine(|engine| engine.silent(track))).map_or(-1, |silent| silent as i32)
}

/// How many samples late a track's output is, from its plan, or -1 if there is no such track.
// TS: return withEngine((engine) => engine.latency(track)) ?? -1
#[unsafe(no_mangle)]
pub extern "C" fn eng_track_latency(track: i32) -> i32 {
    index(track).and_then(|track| with_engine(|engine| engine.latency(track))).map_or(-1, |latency| latency as i32)
}

/// What a node's meter `meter` shows, in section 0 (pre), 1 (voice: the highest of the sounding
/// voices) or 2 (post). NaN (not a number) if there is no such track, section, node or meter.
// TS: return withEngine((engine) => engine.meter(track, section, node, meter)) ?? NaN
// `f32::NAN` is the float "not a number", which JS sees as NaN.
#[unsafe(no_mangle)]
pub extern "C" fn eng_meter(track: i32, section: i32, node: i32, meter: i32) -> f32 {
    let (Some(track), Some(section), Some(node), Some(meter)) = (index(track), index(section), index(node), index(meter)) else {
        return f32::NAN;
    };
    with_engine(|engine| engine.meter(track, section, node, meter)).unwrap_or(f32::NAN)
}

// TS: no equivalent. `#[cfg(test)]` includes the module only when building the tests, so tests/
// isn't part of engine.wasm at all.
#[cfg(test)]
mod tests;
