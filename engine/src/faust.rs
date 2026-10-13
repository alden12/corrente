//! The Faust blocks: the types their generated code expects to find, and the registry compile.ts
//! writes (gen/registry.rs), which numbers the kinds by sorted name.
//!
//! Faust's Rust output names a handful of types it doesn't define (normally from the `faust-types`
//! crate). They are small, so they are declared here instead and the engine has no dependencies.
//!
//! Rust notes, for reading this file:
//! - A `trait` is an interface: `FaustDsp` lists the methods every generated block implements.
//! - `dyn FaustDsp` is "some type implementing it, decided at runtime", and `Box<...>` owns one on
//!   the heap. That is how the router holds blocks of any kind in one list.
//! - Methods on `UI` have default bodies (`{}`), so an implementation only writes the ones it needs.

// TS: an eslint-disable for the whole file. `#![...]` (with the `!`) applies to the file it sits in;
// these silence warnings about Faust's generated naming and unused values.
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals, dead_code, unused_mut, unused_variables, unused_parens)]

// TS: type F32 = number; type FaustFloat = F32;
// (`f32` is a 32-bit float specifically; TS has only the one 64-bit `number`.)
pub type F32 = f32;
pub type FaustFloat = F32;

/// Which of a block's params a call means: the generated `set_param` matches on it.
// TS: type ParamIndex = number & { __brand: "ParamIndex" }, a branded number.
// A "tuple struct" with one field: a distinct type wrapping an i32, read as `index.0`.
// `#[derive(...)]` asks the compiler to write the listed traits for it: `Clone, Copy` let it be
// copied like a number (not moved, see lib.rs), `Debug` printable, `PartialEq, Eq` comparable with ==.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParamIndex(pub i32);

// `&mut self` means the method may change the object it's called on; `&str` is a borrowed string
// (read-only, owned by the caller).
pub trait Meta {
    fn declare(&mut self, key: &str, value: &str);
}

/// What a block describes its controls to. Everything defaults to doing nothing.
// TS: an abstract class UI<T> whose methods all have empty bodies, so a subclass overrides only
// what it needs. (A TS interface can't carry default bodies; a Rust trait can.)
// The `_` prefix on a parameter name says "deliberately unused", like `_label` in TS.
pub trait UI<T> {
    fn open_tab_box(&mut self, _label: &str) {}
    fn open_horizontal_box(&mut self, _label: &str) {}
    fn open_vertical_box(&mut self, _label: &str) {}
    fn close_box(&mut self) {}
    fn add_button(&mut self, _label: &str, _param: ParamIndex) {}
    fn add_check_button(&mut self, _label: &str, _param: ParamIndex) {}
    fn add_vertical_slider(&mut self, _label: &str, _param: ParamIndex, _init: T, _min: T, _max: T, _step: T) {}
    fn add_horizontal_slider(&mut self, _label: &str, _param: ParamIndex, _init: T, _min: T, _max: T, _step: T) {}
    fn add_num_entry(&mut self, _label: &str, _param: ParamIndex, _init: T, _min: T, _max: T, _step: T) {}
    fn add_horizontal_bargraph(&mut self, _label: &str, _param: ParamIndex, _min: T, _max: T) {}
    fn add_vertical_bargraph(&mut self, _label: &str, _param: ParamIndex, _min: T, _max: T) {}
    // TS: param: ParamIndex | undefined. `Option<X>` is Some(x) or None; see `inputs` below.
    fn declare(&mut self, _param: Option<ParamIndex>, _key: &str, _value: &str) {}
}

/// The interface every generated block implements.
// Two things here that TS interfaces don't have:
// - `type T;` is an "associated type": each implementation picks what T is (here always f32),
//   rather than the caller passing it in as a generic.
// - Methods without `self` (`new`, `class_init`, `build_user_interface_static`) are static methods,
//   like `static create()` on a TS class. `where Self: Sized` keeps them off the `dyn FaustDsp`
//   version, which has no known type to call a static method on.
// `&self` borrows the block read-only, `&mut self` lets the method change it.
pub trait FaustDsp {
    type T;
    fn new() -> Self
    where
        Self: Sized;
    fn metadata(&self, m: &mut dyn Meta);
    fn get_sample_rate(&self) -> i32;
    fn get_num_inputs(&self) -> i32;
    fn get_num_outputs(&self) -> i32;
    fn class_init(sample_rate: i32)
    where
        Self: Sized;
    fn instance_reset_params(&mut self);
    fn instance_clear(&mut self);
    fn instance_constants(&mut self, sample_rate: i32);
    fn instance_init(&mut self, sample_rate: i32);
    fn init(&mut self, sample_rate: i32);
    fn build_user_interface(&self, ui_interface: &mut dyn UI<Self::T>);
    fn build_user_interface_static(ui_interface: &mut dyn UI<Self::T>)
    where
        Self: Sized;
    fn get_param(&self, param: ParamIndex) -> Option<Self::T>;
    fn set_param(&mut self, param: ParamIndex, value: Self::T);
    // TS: compute(count: number, inputs: Float32Array[], outputs: Float32Array[]): void
    // `&[&[T]]` is a read-only view of a list of read-only sample arrays; `&mut [&mut [T]]` the same,
    // writable. Rust tracks in the type whether an array may be written through.
    fn compute(&mut self, count: i32, inputs: &[&[Self::T]], outputs: &mut [&mut [Self::T]]);
}

/// Two C maths functions the generated code can call, normally from the `libm` crate; the standard
/// library has what they need.
// TS: export namespace libm { export function rintf(...) {...} }. A `mod` is a namespace; a
// function in it is private unless marked `pub`.
pub mod libm {
    // TS: rintf(value: number): number. The last expression, with no `;`, is the return value.
    pub fn rintf(value: f32) -> f32 {
        value.round_ties_even()
    }
    pub fn remainderf(from: f32, to: f32) -> f32 {
        from - (from / to).round_ties_even() * to
    }
}

/// Any block, behind a pointer: the router doesn't know which kind it runs.
// TS: type Block = FaustDsp<number>. Plain TS interfaces are already "any implementation";
// in Rust you say so with `dyn`.
pub type Block = dyn FaustDsp<T = FaustFloat>;

// The generated blocks, one module each, then FACTORIES, INPUTS, OUTPUTS, COUNT and NAMES.
// No TS equivalent: `include!` pastes another file's text in here at compile time, like a C
// #include, with the path relative to this file. Anything ending in `!` is a macro: code that
// writes code.
include!("../gen/registry.rs");

// TS: export function create(kind: number): Block { return FACTORIES[kind]() }
// `Box<Block>` is a block on the heap, owned by whoever holds the box: when it goes away, so does the
// block (no garbage collector; see lib.rs on ownership). Indexing past the end stops the program
// (a "panic") rather than giving undefined.
pub fn create(kind: usize) -> Box<Block> {
    FACTORIES[kind]()
}

/// How many audio inputs a kind's compute takes, or `None` if there is no such kind.
/// (`Option` is Rust's "maybe a value": `Some(n)` or `None`, never a null to forget to check.)
// TS: Number.isInteger(kind) && kind >= 0 ? INPUTS[kind] : undefined
// - `usize::try_from(kind)` converts with a check, giving a `Result` (ok or error: a negative number
//   is an error); `.ok()` turns that into an Option, dropping the error.
// - `.and_then(f)` is `?.` with a function: run f on the value if there is one, else stay None.
// - `|kind| ...` is a closure, TS `(kind) => ...`.
// - `INPUTS.get(kind)` is a safe index (None past the end) that returns a reference to the value;
//   `.copied()` copies the number out of it.
pub fn inputs(kind: i32) -> Option<usize> {
    usize::try_from(kind).ok().and_then(|kind| INPUTS.get(kind).copied())
}

/// How many outputs a kind's compute writes, or `None` if there is no such kind.
// TS: as `inputs` above, with OUTPUTS.
pub fn outputs(kind: i32) -> Option<usize> {
    usize::try_from(kind).ok().and_then(|kind| OUTPUTS.get(kind).copied())
}

/// A block's controls (its sliders) and its meters (its bargraphs), each in the order it declares
/// them ([n] in a label sets that order).
pub struct Ports {
    pub controls: Vec<ParamIndex>,
    pub meters: Vec<ParamIndex>,
}

/// Ask a block for its controls and meters: it describes them to a UI, and this one just collects.
// TS:
//   function ports(block: Block): Ports {
//     class Collector extends UI { ports = { controls: [], meters: [] }; addHorizontalSlider(_, param) { this.ports.controls.push(param) } ... }
//     const collector = new Collector();
//     block.buildUserInterface(collector);
//     return collector.ports;
//   }
pub fn ports(block: &Block) -> Ports {
    // A tuple struct: its one field is `.0`.
    struct Collector(Ports);
    // TS: Collector implements UI<number>, overriding only these methods. `impl Trait for Type`
    // attaches an interface to a type after the fact, separately from declaring the type.
    impl UI<FaustFloat> for Collector {
        fn add_button(&mut self, _: &str, param: ParamIndex) {
            self.0.controls.push(param);
        }
        fn add_check_button(&mut self, _: &str, param: ParamIndex) {
            self.0.controls.push(param);
        }
        fn add_vertical_slider(&mut self, _: &str, param: ParamIndex, _: F32, _: F32, _: F32, _: F32) {
            self.0.controls.push(param);
        }
        fn add_horizontal_slider(&mut self, _: &str, param: ParamIndex, _: F32, _: F32, _: F32, _: F32) {
            self.0.controls.push(param);
        }
        fn add_num_entry(&mut self, _: &str, param: ParamIndex, _: F32, _: F32, _: F32, _: F32) {
            self.0.controls.push(param);
        }
        fn add_horizontal_bargraph(&mut self, _: &str, param: ParamIndex, _: F32, _: F32) {
            self.0.meters.push(param);
        }
        fn add_vertical_bargraph(&mut self, _: &str, param: ParamIndex, _: F32, _: F32) {
            self.0.meters.push(param);
        }
    }
    // TS: const collector = new Collector({ controls: [], meters: [] }). `let mut`: Rust variables
    // are const unless marked mut.
    let mut collector = Collector(Ports { controls: Vec::new(), meters: Vec::new() });
    // TS: block.buildUserInterface(collector). `&mut collector` lends it out for writing, for the
    // length of the call; we still own it afterwards.
    block.build_user_interface(&mut collector);
    // TS: return collector[0]. The last expression without `;` is returned.
    collector.0
}
