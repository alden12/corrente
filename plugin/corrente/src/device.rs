//! The device the plugin plays, as export.ts wrote it from the app's own compiler: its plan, its
//! binding (the param shaping the engine does, bank/binding.ts), its params' specs (the app's
//! `ParamSpec`), and which param each of the binding's values is.
//!
//! Rust notes, for reading this file:
//! - `#[derive(Deserialize)]` has serde write the JSON reading for a struct; `#[serde(...)]` tunes it
//!   (`tag = "kind"` reads a TS-style discriminated union by its `kind` field).
//! - `Option<T>` is a value that may be missing, like `T | undefined`.

use serde::Deserialize;

#[derive(Deserialize)]
pub struct Device {
    pub label: String,
    /// The compiled plan, as `eng_load` reads it.
    pub words: Vec<i32>,
    /// `eng_bind`'s words up to the values.
    pub binding: Vec<f64>,
    /// Each of the binding's values: the id of the param it is, or None for one nothing sets.
    pub values: Vec<Option<String>>,
    pub params: Vec<ParamSpec>,
}

// TS: type ParamSpec = NumberSpec | EnumSpec | BooleanSpec  (src/audio/params/types.ts)
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ParamSpec {
    Number {
        id: String,
        name: String,
        min: f32,
        max: f32,
        default: f32,
        unit: Option<String>,
        taper: Option<String>,
        step: Option<f32>,
    },
    Enum { id: String, name: String, options: Vec<String>, default: String },
    Boolean { id: String, name: String, default: bool },
}

impl ParamSpec {
    pub fn id(&self) -> &str {
        match self {
            ParamSpec::Number { id, .. } | ParamSpec::Enum { id, .. } | ParamSpec::Boolean { id, .. } => id,
        }
    }
}

/// The device built in: export.ts's output, read once.
pub fn built_in() -> Device {
    serde_json::from_str(include_str!("../device.json")).expect("device.json is export.ts's output")
}
