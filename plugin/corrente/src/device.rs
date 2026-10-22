//! The device the plugin plays, as export.ts wrote it from the app's own compiler: its plan, its
//! params' specs (the app's `ParamSpec`), and which param each of the engine's param sources reads.
//!
//! Rust notes, for reading this file:
//! - `#[derive(Deserialize)]` has serde write the JSON reading for a struct; `#[serde(...)]` tunes it
//!   (`tag = "kind"` reads a TS-style discriminated union by its `kind` field).
//! - `Option<T>` is a value that may be missing, like `T | undefined`.

use serde::Deserialize;

#[derive(Deserialize)]
pub struct Device {
    pub label: String,
    /// The most notes that play at once.
    pub voices: usize,
    /// The compiled plan, as `eng_load` reads it.
    pub words: Vec<i32>,
    pub params: Vec<ParamSpec>,
    pub sources: Vec<Source>,
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

/// One of the engine's param sources: the param it reads (by id), and how its value is shaped on
/// the way in (`resolveNumber` in src/audio/params/table.ts).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub param: Option<String>,
    pub scale: f32,
    pub offset: f32,
    pub table: Option<Vec<(f32, f32)>>,
    pub smooth_ms: Option<f32>,
}

impl Source {
    /// The engine's value for a param value: read off the table if there is one, then scaled and
    /// offset.
    // TS: resolveNumber(raw, source)
    pub fn resolve(&self, raw: f32) -> f32 {
        let looked = self.table.as_deref().map_or(raw, |table| lookup(table, raw));
        looked * self.scale + self.offset
    }
}

/// Piecewise-linear between a table's points, clamped at both ends.
// TS: lookupTable(points, input)
fn lookup(points: &[(f32, f32)], input: f32) -> f32 {
    let (first_input, first_output) = points[0];
    if input <= first_input {
        return first_output;
    }
    match points.iter().position(|&(point_input, _)| point_input >= input) {
        None => points[points.len() - 1].1,
        Some(upper) => {
            let ((from_input, from_output), (to_input, to_output)) = (points[upper - 1], points[upper]);
            from_output + (input - from_input) / (to_input - from_input) * (to_output - from_output)
        }
    }
}

/// The device built in: export.ts's output, read once.
pub fn built_in() -> Device {
    serde_json::from_str(include_str!("../device.json")).expect("device.json is export.ts's output")
}
