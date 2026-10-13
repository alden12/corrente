//! The Faust blocks: the types their generated code expects to find, and the registry build.sh
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

#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals, dead_code, unused_mut, unused_variables, unused_parens)]

pub type F32 = f32;
pub type FaustFloat = F32;

/// Which of a block's params a call means: the generated `set_param` matches on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParamIndex(pub i32);

pub trait Meta {
    fn declare(&mut self, key: &str, value: &str);
}

/// What a block describes its controls to. Everything defaults to doing nothing.
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
    fn declare(&mut self, _param: Option<ParamIndex>, _key: &str, _value: &str) {}
}

/// The interface every generated block implements.
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
    fn compute(&mut self, count: i32, inputs: &[&[Self::T]], outputs: &mut [&mut [Self::T]]);
}

/// Two C maths functions the generated code can call, normally from the `libm` crate; the standard
/// library has what they need.
pub mod libm {
    pub fn rintf(value: f32) -> f32 {
        value.round_ties_even()
    }
    pub fn remainderf(from: f32, to: f32) -> f32 {
        from - (from / to).round_ties_even() * to
    }
}

/// Any block, behind a pointer: the router doesn't know which kind it runs.
pub type Block = dyn FaustDsp<T = FaustFloat>;

// The generated blocks, one module each, then FACTORIES, INPUTS and COUNT.
include!("../gen/registry.rs");

pub fn create(kind: usize) -> Box<Block> {
    FACTORIES[kind]()
}

/// How many audio inputs a kind's compute takes, or `None` if there is no such kind.
/// (`Option` is Rust's "maybe a value": `Some(n)` or `None`, never a null to forget to check.)
pub fn inputs(kind: i32) -> Option<usize> {
    usize::try_from(kind).ok().and_then(|kind| INPUTS.get(kind).copied())
}

/// How many outputs a kind's compute writes, or `None` if there is no such kind.
pub fn outputs(kind: i32) -> Option<usize> {
    usize::try_from(kind).ok().and_then(|kind| OUTPUTS.get(kind).copied())
}

/// A block's controls in declared ([n]) order, which is the order it describes them in.
pub fn controls(block: &Block) -> Vec<ParamIndex> {
    struct Collector(Vec<ParamIndex>);
    impl UI<FaustFloat> for Collector {
        fn add_button(&mut self, _: &str, param: ParamIndex) {
            self.0.push(param);
        }
        fn add_check_button(&mut self, _: &str, param: ParamIndex) {
            self.0.push(param);
        }
        fn add_vertical_slider(&mut self, _: &str, param: ParamIndex, _: F32, _: F32, _: F32, _: F32) {
            self.0.push(param);
        }
        fn add_horizontal_slider(&mut self, _: &str, param: ParamIndex, _: F32, _: F32, _: F32, _: F32) {
            self.0.push(param);
        }
        fn add_num_entry(&mut self, _: &str, param: ParamIndex, _: F32, _: F32, _: F32, _: F32) {
            self.0.push(param);
        }
    }
    let mut collector = Collector(Vec::new());
    block.build_user_interface(&mut collector);
    collector.0
}
