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
mod midi;
mod plan;
mod router;

// For a native host linking the engine as a Rust library (the plugin, PLUGIN-2): the engine as a
// value it owns, one per plugin instance, rather than the thread-local one the exports below share
// (a host may run several instances on a thread, or move one between threads).
// `pub use` re-exports: other crates reach these as `corrente_engine::Engine` and so on.
pub use plan::{Plan, parse as parse_plan};
pub use router::{BLOCK, Engine, Track};

use std::cell::RefCell;

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

// TS: function withTrack<R>(track: number, run: (track: Track) => R): R | undefined { return ENGINE.tracks[track] && run(ENGINE.tracks[track]) }
// The track an export names, or None (ignored) if it's negative or there's no such track.
fn with_track<R>(track: i32, run: impl FnOnce(&mut Track) -> R) -> Option<R> {
    with_engine(|engine| engine.track_mut(index(track)?).map(run))
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

/// Straight after eng_load, hand what the replaced plan's nodes hold to the new plan's (INST-36.7),
/// from memory eng_malloc handed out: whether the voices carry, then for the pre and the post
/// section a count and, for each new node, the old node it takes over (-1 for none). Returns how
/// many nodes carried, or -1 if the words don't fit both plans (nothing changes).
// TS:
//   const words = wordsAt(pointer, length);  // as eng_load reads them
//   const carried = words ? withTrack(track, (track) => track.carry(words)) : undefined;
//   return carried ?? REJECTED;
// `.map_or(default, f)` on an Option: f(value), or the default for None. `.flatten()` turns the
// Option (is there a track?) of an Option (did the words fit?) into one.
#[unsafe(no_mangle)]
pub extern "C" fn eng_carry(track: i32, pointer: *const i32, length: i32) -> i32 {
    let carried = ALLOCATIONS.with_borrow(|allocations| {
        let allocation = allocations.iter().find(|allocation| allocation.as_ptr() == pointer)?;
        let words = allocation.get(..index(length)?)?;
        with_track(track, |track| track.carry(words)).flatten()
    });
    carried.map_or(plan::REJECTED, |count| count as i32)
}

/// Straight after eng_load (and eng_carry), bind the plan: its param sources' shaping, its sample
/// zones and the values they read (router/binding.rs), from memory eng_malloc handed out, f64s as
/// pairs of words. Sets every param from the values and starts the held notes again. 0, or -1 if the
/// words don't make a binding for the track's plan (nothing changes).
// TS: const doubles = doublesAt(pointer, length); return doubles && withEngine((engine) => engine.bind(track, doubles)) ? 0 : REJECTED;
#[unsafe(no_mangle)]
pub extern "C" fn eng_bind(track: i32, pointer: *const i32, length: i32) -> i32 {
    match (doubles_at(pointer, length), index(track)) {
        (Some(doubles), Some(track)) if with_engine(|engine| engine.bind(track, &doubles)) => 0,
        _ => plan::REJECTED,
    }
}

/// Load a track's MIDI devices (INST-11.1, midi/words.rs), from memory eng_malloc handed out, f64s as
/// pairs of words; a chain of no devices takes them away. The keys down start again in the new chain.
/// 0, or -1 if the words don't make a chain (the track keeps the one it had).
// TS: const doubles = doublesAt(pointer, length); return doubles && withEngine((engine) => engine.loadMidi(track, doubles)) ? 0 : REJECTED;
#[unsafe(no_mangle)]
pub extern "C" fn eng_midi_load(track: i32, pointer: *const i32, length: i32) -> i32 {
    match (doubles_at(pointer, length), index(track)) {
        (Some(doubles), Some(track)) if with_engine(|engine| engine.load_midi(track, &doubles)) => 0,
        _ => plan::REJECTED,
    }
}

/// Move one of a track's MIDI device values (a param, or a device's bypass) to `raw`.
// TS: if (value >= 0) withTrack(track, (track) => track.setMidiValue(value, raw))
#[unsafe(no_mangle)]
pub extern "C" fn eng_midi_value(track: i32, value: i32, raw: f64) {
    if let Some(value) = index(value) {
        with_track(track, |track| track.set_midi_value(value, raw));
    }
}

/// The f64s in memory eng_malloc handed out, `length` int32 words of it, two words to each (low half
/// first): None for memory the engine didn't hand out, or an odd number of words.
// TS:
//   const words = wordsAt(pointer, length);  // as eng_load reads them
//   return words && new Float64Array(words.buffer, words.byteOffset, words.length / 2);
// `chunks_exact(2)` walks the words two at a time. `f64::from_bits` makes a float from its 64 bits:
// the high word shifted up 32 bits, or'd with the low one (`as u32` keeps a negative word's bits).
fn doubles_at(pointer: *const i32, length: i32) -> Option<Vec<f64>> {
    ALLOCATIONS.with_borrow(|allocations| {
        let allocation = allocations.iter().find(|allocation| allocation.as_ptr() == pointer)?;
        let words = allocation.get(..index(length)?)?;
        let pairs = words.chunks_exact(2);
        pairs.remainder().is_empty().then(|| pairs.map(|pair| f64::from_bits(u64::from(pair[1] as u32) << 32 | u64::from(pair[0] as u32))).collect::<Vec<_>>())
    })
}

/// Start a note by key on a track, `offset` samples into the coming block: the track picks the voice
/// slot and the sample zone (router/keys.rs). `note` is its MIDI note number, `velocity` 0 to 1.
// TS: if (track >= 0) withEngine((engine) => engine.keyOn(track, offset, note, velocity))
#[unsafe(no_mangle)]
pub extern "C" fn eng_key_on(track: i32, offset: i32, note: i32, velocity: f64) {
    if let Some(track) = index(track) {
        with_engine(|engine| engine.key_on(track, offset, note, velocity));
    }
}

/// Release a note by key on a track, `offset` samples into the coming block.
// TS: withTrack(track, (track) => track.keyOff(offset, note))
#[unsafe(no_mangle)]
pub extern "C" fn eng_key_off(track: i32, offset: i32, note: i32) {
    with_track(track, |track| track.key_off(offset, note));
}

/// Release every held note on a track, `offset` samples into the coming block.
// TS: withTrack(track, (track) => track.keysOff(offset))
#[unsafe(no_mangle)]
pub extern "C" fn eng_keys_off(track: i32, offset: i32) {
    with_track(track, |track| track.keys_off(offset));
}

/// Move one of a track's values (a param's raw value, numbered as eng_bind's words number them): each
/// param source reading it ramps to its shaped value.
// TS: if (value >= 0) withTrack(track, (track) => track.setValue(value, raw));
#[unsafe(no_mangle)]
pub extern "C" fn eng_set_value(track: i32, value: i32, raw: f64) {
    if let Some(value) = index(value) {
        with_track(track, |track| track.set_value(value, raw));
    }
}

/// Set one of a track's values at once, with no ramp: a sample param pointed at another slot.
// TS: if (value >= 0) withTrack(track, (track) => track.initValue(value, raw));
#[unsafe(no_mangle)]
pub extern "C" fn eng_init_value(track: i32, value: i32, raw: f64) {
    if let Some(value) = index(value) {
        with_track(track, |track| track.init_value(value, raw));
    }
}

/// Set a track param's value; it ramps there over its ramp (a block unless eng_param_ramp says).
// TS: if (source >= 0) withTrack(track, (track) => track.setParam(source, value));
// `if let Some(source) = index(source)` runs the block only if it's there, naming it: a one-case
// `match`. `if let (Some(a), Some(b)) = (x, y)`, below, does it for a pair.
#[unsafe(no_mangle)]
pub extern "C" fn eng_set_param(track: i32, source: i32, value: f32) {
    if let Some(source) = index(source) {
        with_track(track, |track| track.set_param(source, value));
    }
}

/// How many samples a track param's changes ramp over, at least one (a block unless this says).
// TS: if (source >= 0 && samples >= 0) withTrack(track, (track) => track.setRamp(source, samples));
#[unsafe(no_mangle)]
pub extern "C" fn eng_param_ramp(track: i32, source: i32, samples: i32) {
    if let (Some(source), Some(samples)) = (index(source), index(samples)) {
        with_track(track, |track| track.set_ramp(source, samples));
    }
}

/// Jump a track param to a value with no ramp (its starting value).
// TS: if (source >= 0) withTrack(track, (track) => track.initParam(source, value));
#[unsafe(no_mangle)]
pub extern "C" fn eng_init_param(track: i32, source: i32, value: f32) {
    if let Some(source) = index(source) {
        with_track(track, |track| track.init_param(source, value));
    }
}

/// Start a note in a track's voice slot, `offset` samples into the coming block. `note` is its MIDI
/// note number (60 is middle C), for definitions that key-track.
// TS: if (slot >= 0) withTrack(track, (track) => track.noteOn(slot, offset, frequency, velocity, note));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_on(track: i32, slot: i32, offset: i32, frequency: f32, velocity: f32, note: f32) {
    if let Some(slot) = index(slot) {
        with_track(track, |track| track.note_on(slot, offset, frequency, velocity, note));
    }
}

/// Set one of the zone signals (5 sample slot, 6 root note, 7 start, 8 end) of the note just started
/// in a track's voice slot, for the coming block: the sample zone picked for it. Other signals,
/// and slots not sounding, are ignored.
// TS: if (slot >= 0 && signal >= 0) withTrack(track, (track) => track.setVoiceSignal(slot, signal, value));
#[unsafe(no_mangle)]
pub extern "C" fn eng_voice_signal(track: i32, slot: i32, signal: i32, value: f32) {
    if let (Some(slot), Some(signal)) = (index(slot), index(signal)) {
        with_track(track, |track| track.set_voice_signal(slot, signal, value));
    }
}

/// Release the note in a track's voice slot, `offset` samples into the coming block.
// TS: if (slot >= 0) withTrack(track, (track) => track.noteOff(slot, offset));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_off(track: i32, slot: i32, offset: i32) {
    if let Some(slot) = index(slot) {
        with_track(track, |track| track.note_off(slot, offset));
    }
}

/// Fade the voice in a track's slot out over a block from `offset`, then free the slot: how a voice
/// is stolen without a click.
// TS: if (slot >= 0) withTrack(track, (track) => track.cut(slot, offset));
#[unsafe(no_mangle)]
pub extern "C" fn eng_note_cut(track: i32, slot: i32, offset: i32) {
    if let Some(slot) = index(slot) {
        with_track(track, |track| track.cut(slot, offset));
    }
}

/// How many voice slots a track has: its plan's voices and a few spares, which the allocator picks from.
/// -1 if there is no such track.
// TS: return withTrack(track, (track) => track.voiceSlots()) ?? -1
// `.map_or(-1, f)` gives -1 for None (no such track).
#[unsafe(no_mangle)]
pub extern "C" fn eng_voice_slots(track: i32) -> i32 {
    with_track(track, |track| track.voice_slots()).map_or(-1, |slots| slots as i32)
}

/// 1 if the track's voice slot is sounding (including its release), 0 if it is free.
// TS: return Number(slot >= 0 && withTrack(track, (track) => track.voiceActive(slot)))
// `.is_some_and(f)`: false if missing, else f(value). `as i32` turns a bool into 0 or 1.
#[unsafe(no_mangle)]
pub extern "C" fn eng_voice_active(track: i32, slot: i32) -> i32 {
    let active = index(slot).and_then(|slot| with_track(track, |track| track.voice_active(slot)));
    active.unwrap_or(false) as i32
}

/// Where to write a track's audio input channel (128 samples) before the next eng_process, or 0 if
/// there is no such track or channel. The address stays put, so JS views it once.
// TS: return addressOf(withTrack(track, (track) => track.inputMut(channel))) ?? 0
// `*mut f32` is a raw pointer, a plain address with no ownership: what JS needs to find the memory.
// `.map_or(default, f)`: f(value) if there is one, else the default; `std::ptr::null_mut()` is 0.
#[unsafe(no_mangle)]
pub extern "C" fn eng_input(track: i32, channel: i32) -> *mut f32 {
    let Some(channel) = index(channel) else { return std::ptr::null_mut() };
    with_track(track, |track| track.input_mut(channel).map(|input| input.as_mut_ptr())).flatten().unwrap_or(std::ptr::null_mut())
}

/// Where a track's output channel (128 samples) is after eng_process, or 0 if there is no such
/// track or channel. The address stays put, so JS views it once.
// TS: return addressOf(withTrack(track, (track) => track.output(channel))) ?? 0
// `std::ptr::null()` is the read-only null; `.as_ptr()` is the array's address.
#[unsafe(no_mangle)]
pub extern "C" fn eng_output(track: i32, channel: i32) -> *const f32 {
    let Some(channel) = index(channel) else { return std::ptr::null() };
    with_track(track, |track| track.output(channel).map(|output| output.as_ptr())).flatten().unwrap_or(std::ptr::null())
}

/// Where the transport is at the start of the coming block: `beat` (counted from where it started),
/// `tempo` in beats a minute, and `playing` (0 or 1). Feeds the host signals every plan can read.
// TS: withEngine((engine) => engine.setTransport(beat, tempo, playing !== 0))
#[unsafe(no_mangle)]
pub extern "C" fn eng_transport(beat: f64, tempo: f32, playing: i32) {
    with_engine(|engine| engine.set_transport(beat, tempo, playing != 0));
}

/// Make room for a sample in slot `slot` (0 to 255), `frames` long with 1 or 2 `channels` at its own
/// `rate`, and return where JS writes it: channel 0's frames, then channel 1's. 0 if the slot doesn't
/// exist or the sample is too big. Memory may grow, so JS makes its views again after this.
// TS: return addressOf(withEngine((engine) => engine.reserveSample(slot, frames, channels, rate))) ?? 0
#[unsafe(no_mangle)]
pub extern "C" fn eng_sample_reserve(slot: i32, frames: i32, channels: i32, rate: f32) -> *mut f32 {
    let (Some(slot), Some(frames), Some(channels)) = (index(slot), index(frames), index(channels)) else { return std::ptr::null_mut() };
    with_engine(|engine| engine.reserve_sample(slot, frames, channels, rate).map_or(std::ptr::null_mut(), |data| data.as_mut_ptr()))
}

/// Empty a sample slot, freeing its memory.
// TS: if (slot >= 0) withEngine((engine) => engine.freeSample(slot))
#[unsafe(no_mangle)]
pub extern "C" fn eng_sample_free(slot: i32) {
    if let Some(slot) = index(slot) {
        with_engine(|engine| engine.free_sample(slot));
    }
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
// TS: return withTrack(track, (track) => track.peak(channel)) ?? -1
// `.and_then(f)` chains a lookup that may come up empty; `.flatten()` turns the Option (is there a
// track?) of an Option (is there a channel?) into one.
#[unsafe(no_mangle)]
pub extern "C" fn eng_track_peak(track: i32, channel: i32) -> f32 {
    let found = index(channel).and_then(|channel| with_track(track, |track| track.peak(channel)).flatten());
    found.unwrap_or(-1.0)
}

/// 1 if a track was silent last block (no voice sounding, nothing out), 0 if not, -1 if there is no
/// such track.
// TS: const silent = withTrack(track, (track) => track.silent()); return silent === undefined ? -1 : Number(silent)
#[unsafe(no_mangle)]
pub extern "C" fn eng_track_silent(track: i32) -> i32 {
    with_track(track, |track| track.silent()).map_or(-1, |silent| silent as i32)
}

/// What a node's meter `meter` shows, in section 0 (pre), 1 (voice: the highest of the sounding
/// voices) or 2 (post). NaN (not a number) if there is no such track, section, node or meter.
// TS: return withTrack(track, (track) => track.meter(section, node, meter)) ?? NaN
// `f32::NAN` is the float "not a number", which JS sees as NaN.
#[unsafe(no_mangle)]
pub extern "C" fn eng_meter(track: i32, section: i32, node: i32, meter: i32) -> f32 {
    let (Some(section), Some(node), Some(meter)) = (index(section), index(node), index(meter)) else { return f32::NAN };
    with_track(track, |track| track.meter(section, node, meter)).flatten().unwrap_or(f32::NAN)
}

// TS: no equivalent. `#[cfg(test)]` includes the module only when building the tests, so tests/
// isn't part of engine.wasm at all.
#[cfg(test)]
mod tests;
