//! Corrente's audio engine (INST-36): Faust blocks compiled to Rust, run by a router that follows a
//! plan built from a device's definition. This file is the module's surface: the functions the
//! browser calls, all named `eng_*`.
//!
//! So far (INST-36.1) it holds the blocks and can describe them, which is enough to prove the
//! toolchain end to end and give the tests something real to check. The router arrives in INST-36.3.
//!
//! Rust notes, for reading this file:
//! - `mod faust;` pulls in src/faust.rs as a module.
//! - `#[unsafe(no_mangle)] pub extern "C"` exports a function under its own name with a calling
//!   convention JavaScript can call. The `unsafe` marks that the name is exported as is, and so must
//!   not clash with anything else: nothing in the body is unsafe.
//! - `i32` is a 32-bit integer, what WebAssembly passes across; `usize` is Rust's index type.

mod faust;

/// How many kinds of block the engine has. Kinds are numbered 0 to count - 1, by sorted name.
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_count() -> i32 {
    faust::COUNT as i32
}

/// How many audio inputs a kind takes, or -1 if there is no such kind.
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_inputs(kind: i32) -> i32 {
    faust::inputs(kind).map_or(-1, |count| count as i32)
}

/// How many outputs a kind writes, or -1 if there is no such kind.
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_outputs(kind: i32) -> i32 {
    faust::outputs(kind).map_or(-1, |count| count as i32)
}

/// How many control inputs (Faust sliders) a kind has, or -1 if there is no such kind. Making a
/// block to ask is the only way to know, so this also proves every block can be built.
#[unsafe(no_mangle)]
pub extern "C" fn eng_block_controls(kind: i32) -> i32 {
    match usize::try_from(kind) {
        Ok(kind) if kind < faust::COUNT => faust::controls(&*faust::create(kind)).len() as i32,
        _ => -1,
    }
}
