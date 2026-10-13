//! Corrente's audio engine (INST-36): Faust blocks compiled to Rust, run by a router that follows a
//! plan built from a device's definition. This file is the module's surface: the functions the
//! browser calls, all named `eng_*`.
//!
//! - faust.rs is what the Faust blocks have in common; compile.ts generates the blocks themselves into gen/.
//! - plan.rs reads and checks a plan.
//! - router.rs runs it, voice by voice.
//!
//! The exports are thin: each borrows the one engine and calls a method on it. WebAssembly here is
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

// TS: import * as faust from "./faust"; and the same for plan and router. Declaring a module is
// what makes its file part of the build. These three are private: only this file sees them.
mod faust;
mod plan;
mod router;

// TS: import { RefCell } from "std/cell"; import { BLOCK, Engine } from "./router";
use std::cell::RefCell;

use router::{BLOCK, Engine};

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

/// Grow the heap once, up front, and hand it back to the allocator. Later allocations (loading a
/// plan) then reuse it rather than growing memory, which would detach JS's view of the mix. Chunks
/// stay small so the allocator keeps them rather than treating each as its own mapping.
// TS: const RESERVED_HEAP = 32 * 2 ** 20; const RESERVE_CHUNK = 64 * 2 ** 10;  (32MB, 64KB)
// `const` needs its type written out; `<<` is a bit shift, as in TS.
const RESERVED_HEAP: usize = 32 << 20;
const RESERVE_CHUNK: usize = 64 << 10;

/// Called once when the module starts.
// TS: const chunks = Array.from({ length: RESERVED_HEAP / RESERVE_CHUNK }, () => new Uint8Array(RESERVE_CHUNK));
// `(0..n)` is a range, 0 to n - 1; `.map(|_| ...)` ignores the number. `Vec::with_capacity`
// reserves room without filling it. `drop(...)` frees them now rather than at the end of the
// function: the memory goes back to the allocator, which keeps it for later.
#[unsafe(no_mangle)]
pub extern "C" fn _initialize() {
    let chunks: Vec<Vec<u8>> = (0..RESERVED_HEAP / RESERVE_CHUNK).map(|_| Vec::with_capacity(RESERVE_CHUNK)).collect();
    // black_box, or the optimizer sees allocations nobody uses and removes them.
    drop(std::hint::black_box(chunks));
}

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

/// Set the sample rate and how many voices there are. Returns the number of block kinds.
// TS: return withEngine((engine) => engine.init(rate, Math.max(maxVoices, 0)))
#[unsafe(no_mangle)]
pub extern "C" fn eng_init(rate: i32, max_voices: i32) -> i32 {
    with_engine(|engine| engine.init(rate, usize::try_from(max_voices).unwrap_or(0)))
}

/// Load a plan from memory eng_malloc handed out. Returns 0, or -1 for a bad plan and -2 for one
/// of the wrong length (the engine is unchanged either way).
// TS:
//   const allocation = ALLOCATIONS.find((allocation) => addressOf(allocation) === pointer);
//   const words = allocation && length >= 0 && length <= allocation.length ? allocation.subarray(0, length) : undefined;
//   if (!words) return REJECTED;
//   const parsed = parse(words);  // a plan, or an error code
//   if (isErrorCode(parsed)) return parsed;
//   withEngine((engine) => engine.load(parsed));
//   return 0;
// Inside the closure, `?` works on Options: a None returns None from the closure straight away.
// `allocation.get(..n)` is the first n words, or None if there aren't that many.
// The `match` then handles the three outcomes: `Some(Ok(plan))` pulls the plan out of both
// wrappers, `Some(Err(code))` the error code, and `None` is "no such allocation".
#[unsafe(no_mangle)]
pub extern "C" fn eng_load(pointer: *const i32, length: i32) -> i32 {
    // Reading the plan through its allocation, not the raw pointer, keeps this safe: a pointer the
    // engine didn't hand out is rejected rather than read.
    let parsed = ALLOCATIONS.with_borrow(|allocations| {
        let allocation = allocations.iter().find(|allocation| allocation.as_ptr() == pointer)?;
        let words = allocation.get(..usize::try_from(length).ok()?)?;
        Some(plan::parse(words))
    });
    match parsed {
        Some(Ok(plan)) => {
            with_engine(|engine| engine.load(plan));
            0
        }
        Some(Err(code)) => code,
        None => plan::REJECTED,
    }
}

/// Set a param source's value; it ramps there over the next block.
// TS: if (source >= 0) withEngine((engine) => engine.setParam(source, value));
// `if let Ok(source) = ...` runs the block only if the conversion succeeded, with the converted
// value as `source`: a one-case `match`.
#[unsafe(no_mangle)]
pub extern "C" fn eng_set_param(source: i32, value: f32) {
    if let Ok(source) = usize::try_from(source) {
        with_engine(|engine| engine.set_param(source, value));
    }
}

/// Jump a param source to a value with no ramp (its starting value).
// TS: if (source >= 0) withEngine((engine) => engine.initParam(source, value));
#[unsafe(no_mangle)]
pub extern "C" fn eng_init_param(source: i32, value: f32) {
    if let Ok(source) = usize::try_from(source) {
        with_engine(|engine| engine.init_param(source, value));
    }
}

/// Start a note in a voice slot, `offset` samples into the coming block.
// TS: if (slot >= 0) withEngine((engine) => engine.noteOn(slot, offset, frequency, velocity));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_on(slot: i32, offset: i32, frequency: f32, velocity: f32) {
    if let Ok(slot) = usize::try_from(slot) {
        with_engine(|engine| engine.note_on(slot, offset, frequency, velocity));
    }
}

/// Release the note in a voice slot, `offset` samples into the coming block.
// TS: if (slot >= 0) withEngine((engine) => engine.noteOff(slot, offset));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_off(slot: i32, offset: i32) {
    if let Ok(slot) = usize::try_from(slot) {
        with_engine(|engine| engine.note_off(slot, offset));
    }
}

/// 1 if the slot is sounding (including its release), 0 if it is free.
// TS: return Number(slot >= 0 && withEngine((engine) => engine.voiceActive(slot)))
// `.is_ok_and(f)`: false if the conversion failed, else f(value). `as i32` turns a bool into 0 or 1.
#[unsafe(no_mangle)]
pub extern "C" fn eng_voice_active(slot: i32) -> i32 {
    usize::try_from(slot).is_ok_and(|slot| with_engine(|engine| engine.voice_active(slot))) as i32
}

/// Render one block. Returns where the 128-sample mono mix is; it stays put, so JS views it once.
// TS: return addressOf(withEngine((engine) => engine.process()))
// `[f32; BLOCK]` is a fixed-length array type, BLOCK floats. `process` returns a loan of the
// engine's mix, which can't outlive the closure; `as *const _` turns it into a raw address, which
// can (`_` lets the compiler fill in the type). JS reads the samples at that address.
#[unsafe(no_mangle)]
pub extern "C" fn eng_process() -> *const [f32; BLOCK] {
    with_engine(|engine| engine.process() as *const _)
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

/// How many control inputs (Faust sliders) a kind has, or -1 if there is no such kind. Making a
/// block to ask is the only way to know, so this also proves every block can be built.
// TS:
//   if (kind >= 0 && kind < faust.COUNT) return faust.controls(faust.create(kind)).length;
//   return -1;
// `match` is a switch that must cover every case. `Ok(kind) if ...` matches a successful conversion
// and pulls the value out as `kind`, with an extra condition; `_` is `default:`.
// `&*faust::create(kind)`: create returns a Box (an owned block); `*` reaches the block inside and
// `&` lends it to `controls`. The box is dropped, freeing the block, at the end of the statement.
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_controls(kind: i32) -> i32 {
    match usize::try_from(kind) {
        Ok(kind) if kind < faust::COUNT => faust::controls(&*faust::create(kind)).len() as i32,
        _ => -1,
    }
}

// TS: no equivalent. `#[cfg(test)]` includes the module only when building the tests, so tests.rs
// isn't part of engine.wasm at all.
#[cfg(test)]
mod tests;
