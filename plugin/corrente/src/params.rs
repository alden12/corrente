//! The plugin's host params and saved state: 16 macros and the device package.
//!
//! - **Macros, not the device's own params:** a host takes a plugin's params once, when it makes the
//!   plugin, and nice-plug can't tell it they changed, so the list can't follow the device loaded. Each
//!   macro is a knob from 0 to 1, mapped for now to one of the device's params in order (the first 16
//!   that aren't samples); the window will let you choose. The host shows the mapped param's name and
//!   value in the macro's text.
//! - **The package is saved with the host's project** (`serialize_fields`), as the JSON it came as,
//!   and loading it again (`deserialize_fields`) builds its engine off the audio thread
//!   (device.rs), for the plugin to swap in between blocks.
//!
//! Rust notes, for reading this file:
//! - `unsafe impl Params` is implementing a trait whose contract Rust can't check: here, that the
//!   pointers `param_map` hands out stay valid as long as the params do (they live in `self`).
//! - `Mutex` and `RwLock` guard what more than one thread reads: the host's threads and the audio
//!   thread. The audio thread only ever `try_lock`s, so it never waits.

use crate::device::{self, Prepared};
use crate::package::{Package, ParamSpec, Value};
use nice_plug::prelude::*;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};

pub const MACROS: usize = 16;
/// The key the package is saved under in the plugin's state.
const PACKAGE_FIELD: &str = "package";

/// A device param a macro is mapped to: which of the binding's values it sets, and how.
pub struct Target {
    pub value: usize,
    pub title: String,
    pub spec: ParamSpec,
    /// The engine value the package had, which plays until the macro moves off its position.
    pub raw: f64,
}

/// The first MACROS of a package's params, in order, as the macros' targets.
// TS:
//   return package.values.flatMap((kind, value) => kind.kind === "param" ? [{ value, title, spec, raw }] : []).slice(0, MACROS);
// `filter_map` keeps each Some its closure returns; `.take(MACROS)` stops after the first 16.
pub fn targets_of(package: &Package) -> Vec<Target> {
    let params = package.values.iter().enumerate().filter_map(|(value, kind)| match kind {
        Value::Param { title, spec, raw } => Some(Target { value, title: title.clone(), spec: spec.clone(), raw: *raw }),
        _ => None,
    });
    params.take(MACROS).collect()
}

pub struct Macros {
    pub knobs: Vec<FloatParam>,
    /// What each macro is mapped to now, for the host's text. Changed only off the audio thread.
    pub targets: Arc<RwLock<Vec<Target>>>,
    /// The package playing, as JSON: what is saved.
    pub package: Mutex<String>,
    /// A device built off the audio thread, waiting to be swapped in.
    pub incoming: Mutex<Option<Box<Prepared>>>,
    /// The device it replaced, handed back to be freed off the audio thread.
    pub retired: Mutex<Option<Box<Prepared>>>,
    /// The sample rate the plugin is active at (f32 bits), 0 before it first is.
    pub rate: AtomicU32,
}

impl Macros {
    /// Macros for `json`'s package, each knob starting at its target's value.
    pub fn new(json: String, package: &Package) -> Self {
        // TS:
        //   const targets = targetsOf(package);
        //   const knobs = Array.from({ length: MACROS }, (_, index) => new FloatParam(`Macro ${index + 1}`,
        //     targets[index] ? targets[index].spec.position(targets[index].raw) : 0.5, { min: 0, max: 1 })
        //     .withValueToString((position) => targets[index] ? `${title}: ${display(engineValue(position))}` : ""));
        // `RwLock` lets many threads read at once, or one write. Each knob's text closure keeps its own
        // `Arc` of the targets (`shown`), so it sees them change; `move` hands the closure what it uses.
        let targets = Arc::new(RwLock::new(targets_of(package)));
        let knobs = (0..MACROS)
            .map(|index| {
                let start = targets.read().ok().and_then(|targets| targets.get(index).map(|target| target.spec.position(target.raw)));
                let shown = targets.clone();
                FloatParam::new(format!("Macro {}", index + 1), start.unwrap_or(0.5) as f32, FloatRange::Linear { min: 0.0, max: 1.0 })
                    .with_value_to_string(Arc::new(move |position| {
                        let targets = shown.read();
                        let target = targets.as_ref().ok().and_then(|targets| targets.get(index));
                        target.map_or_else(String::new, |target| format!("{}: {}", target.title, target.spec.display(target.spec.engine_value(f64::from(position)))))
                    }))
            })
            .collect();
        // TS: return { knobs, targets, package: json, incoming: undefined, retired: undefined, rate: 0 }
        Macros {
            knobs,
            targets,
            package: Mutex::new(json),
            incoming: Mutex::new(None),
            retired: Mutex::new(None),
            rate: AtomicU32::new(0),
        }
    }

    /// The sample rate the plugin is active at, if it has been.
    // TS: return this.rate > 0 ? this.rate : undefined
    pub fn active_rate(&self) -> Option<f32> {
        Some(f32::from_bits(self.rate.load(Ordering::Acquire))).filter(|&rate| rate > 0.0)
    }

    /// Play `json`'s package from the next block: build its engine now, here (off the audio thread),
    /// for the plugin to swap in. False, changing nothing, for one that won't load.
    pub fn load(&self, json: String) -> bool {
        // TS: const package = Package.parse(json); if (!package) return false;
        let Some(package) = Package::parse(&json) else { return false };
        // A device the audio thread let go of is freed here, where freeing is allowed.
        if let Ok(mut retired) = self.retired.lock() {
            retired.take();
        }
        // TS: const rate = this.activeRate(); if (rate) { const prepared = prepare(package, rate, this.knobs); if (!prepared) return false; this.incoming = prepared; }
        if let Some(rate) = self.active_rate() {
            let Some(prepared) = device::prepare(&package, rate, &self.knobs) else { return false };
            if let Ok(mut incoming) = self.incoming.lock() {
                *incoming = Some(Box::new(prepared));
            }
        }
        // TS: this.targets = targetsOf(package); this.package = json; return true;
        // `.write()` takes the RwLock for writing; `*targets = ...` replaces what it guards.
        if let Ok(mut targets) = self.targets.write() {
            *targets = targets_of(&package);
        }
        if let Ok(mut saved) = self.package.lock() {
            *saved = json;
        }
        true
    }
}

unsafe impl Params for Macros {
    // TS: return this.knobs.map((knob, index) => [`macro${index + 1}`, knob, ""])  (id, param, group)
    fn param_map(&self) -> Vec<(String, ParamPtr, String)> {
        self.knobs.iter().enumerate().map(|(index, knob)| (format!("macro{}", index + 1), knob.as_ptr(), String::new())).collect()
    }

    // TS: return new Map([["package", this.package]])
    fn serialize_fields(&self) -> BTreeMap<String, String> {
        let package = self.package.lock().map(|package| package.clone()).unwrap_or_default();
        BTreeMap::from([(PACKAGE_FIELD.to_owned(), package)])
    }

    // The host's project is opening, or a preset loading: the macros' values are already restored.
    // TS: const json = serialized.get("package"); if (json !== undefined && !this.load(json)) log the failure;
    fn deserialize_fields(&self, serialized: &BTreeMap<String, String>) {
        if let Some(json) = serialized.get(PACKAGE_FIELD) {
            if !self.load(json.clone()) {
                nice_error!("the saved device didn't load");
            }
        }
    }
}
