//! The plugin's host params and saved state: 16 macros and the device package.
//!
//! - **Macros, not the device's own params:** a host takes a plugin's params once, when it makes the
//!   plugin, and nice-plug can't tell it they changed, so the list can't follow the device loaded. Each
//!   macro is a knob from 0 to 1, mapped for now to one of the device's params in order (the first 16
//!   that aren't samples); the window will let you choose. The host shows the mapped param's name and
//!   value in the macro's text.
//! - **The package is saved with the host's project** (`serialize_fields`), with any value the window
//!   has moved since, and loading it again (`deserialize_fields`) builds its engine off the audio
//!   thread (device.rs), for the plugin to swap in between blocks.
//! - **The window** (editor.rs) sends a package on every change. One that is the same device with
//!   values moved isn't rebuilt: each moved value goes through `changes`, a queue the audio thread
//!   empties between blocks. The window's own state, its `rack`, is saved beside the package, so it
//!   opens again as it was.
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
/// The keys the package and the window's state are saved under in the plugin's state.
const PACKAGE_FIELD: &str = "package";
const RACK_FIELD: &str = "rack";

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

/// Room for the value changes waiting for the audio thread: one per value, so more than any device has.
const MAX_CHANGES: usize = 256;

pub struct Macros {
    pub knobs: Vec<FloatParam>,
    /// What each macro is mapped to now, for the host's text. Changed only off the audio thread.
    pub targets: Arc<RwLock<Vec<Target>>>,
    /// The package playing, with the window's changes: what is saved.
    pub package: Mutex<Package>,
    /// The window's project snapshot (JSON), empty before it has opened.
    pub rack: Mutex<String>,
    /// Values the window moved, by number, for the audio thread to set between blocks.
    pub changes: Mutex<Vec<(usize, f64)>>,
    /// A device built off the audio thread, waiting to be swapped in.
    pub incoming: Mutex<Option<Box<Prepared>>>,
    /// The device it replaced, handed back to be freed off the audio thread.
    pub retired: Mutex<Option<Box<Prepared>>>,
    /// The sample rate the plugin is active at (f32 bits), 0 before it first is.
    pub rate: AtomicU32,
}

impl Macros {
    /// Macros for `package`, each knob starting at its target's value.
    pub fn new(package: Package) -> Self {
        // TS:
        //   const targets = targetsOf(package);
        //   const knobs = Array.from({ length: MACROS }, (_, index) => new FloatParam(`Macro ${index + 1}`,
        //     targets[index] ? targets[index].spec.position(targets[index].raw) : 0.5, { min: 0, max: 1 })
        //     .withValueToString((position) => targets[index] ? `${title}: ${display(engineValue(position))}` : ""));
        // `RwLock` lets many threads read at once, or one write. Each knob's text closure keeps its own
        // `Arc` of the targets (`shown`), so it sees them change; `move` hands the closure what it uses.
        let targets = Arc::new(RwLock::new(targets_of(&package)));
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
        // TS: return { knobs, targets, package, rack: "", changes: [], incoming: undefined, retired: undefined, rate: 0 }
        Macros {
            knobs,
            targets,
            package: Mutex::new(package),
            rack: Mutex::new(String::new()),
            changes: Mutex::new(Vec::with_capacity(MAX_CHANGES)),
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

    /// Play `json`'s package from the next block. The same device with values moved sets just those
    /// (`set_value`), and they're returned; another device's engine is built now, here (off the audio
    /// thread), for the plugin to swap in. None, changing nothing, for one that won't load.
    pub fn load(&self, json: &str) -> Option<Vec<(usize, f64)>> {
        // TS: const package = Package.parse(json); if (!package) return undefined;
        let package = Package::parse(json)?;
        // TS:
        //   if (this.package.sameDevice(package)) {
        //     const moved = package.values.flatMap((value, index) => value.raw !== undefined && value.raw !== this.package.values[index].raw ? [[index, value.raw]] : []);
        //     moved.forEach(([index, raw]) => this.setValue(index, raw));
        //     return moved;
        //   }
        // The block in `let moved = { ... }` holds the lock only while it runs, so `set_value` can take it.
        let moved: Option<Vec<(usize, f64)>> = {
            let saved = self.package.lock().ok()?;
            saved.same_device(&package).then(|| {
                let pairs = saved.values.iter().zip(&package.values).enumerate();
                pairs
                    .filter_map(|(index, (mine, theirs))| theirs.raw().filter(|raw| Some(*raw) != mine.raw()).map(|raw| (index, raw)))
                    .collect()
            })
        };
        if let Some(moved) = moved {
            moved.iter().for_each(|&(index, raw)| self.set_value(index, raw));
            return Some(moved);
        }
        // A device the audio thread let go of is freed here, where freeing is allowed.
        if let Ok(mut retired) = self.retired.lock() {
            retired.take();
        }
        // TS: const rate = this.activeRate(); if (rate) { const prepared = prepare(package, rate, this.knobs); if (!prepared) return undefined; this.changes = []; this.incoming = prepared; }
        // Changes waiting were the old device's, so they go before the new one can be taken.
        if let Some(rate) = self.active_rate() {
            let prepared = device::prepare(&package, rate, &self.knobs)?;
            if let Ok(mut changes) = self.changes.lock() {
                changes.clear();
            }
            if let Ok(mut incoming) = self.incoming.lock() {
                *incoming = Some(Box::new(prepared));
            }
        }
        // TS: this.targets = targetsOf(package); this.package = package; return [];
        // `.write()` takes the RwLock for writing; `*targets = ...` replaces what it guards.
        if let Ok(mut targets) = self.targets.write() {
            *targets = targets_of(&package);
        }
        if let Ok(mut saved) = self.package.lock() {
            *saved = package;
        }
        Some(Vec::new())
    }

    /// Value `index` moved to `raw` in the window: saved with the package, and queued for the audio
    /// thread. A value already waiting is replaced, so a fast drag queues one change, not hundreds.
    pub fn set_value(&self, index: usize, raw: f64) {
        // TS: this.package.values[index]?.setRaw(raw);
        if let Some(value) = self.package.lock().ok().as_deref_mut().and_then(|package| package.values.get_mut(index)) {
            value.set_raw(raw);
        }
        // TS: const waiting = this.changes.find(([number]) => number === index); if (waiting) waiting[1] = raw; else if (this.changes.length < MAX_CHANGES) this.changes.push([index, raw]);
        // `.position(...)` here is the list's (findIndex); `changes[at].1` is that pair's second item.
        let Ok(mut changes) = self.changes.lock() else { return };
        match changes.iter().position(|(number, _)| *number == index) {
            Some(at) => changes[at].1 = raw,
            None if changes.len() < MAX_CHANGES => changes.push((index, raw)),
            None => nice_error!("too many value changes waiting; one was dropped"),
        }
    }

    /// The macro mapped to value `index`, if one is, and where its knob sits for `raw`.
    // TS: const knob = this.targets.findIndex((target) => target.value === index); return knob < 0 ? undefined : [knob, this.targets[knob].spec.position(raw)];
    // `.position(...)` here is the list's: the index of the first match, as findIndex.
    pub fn macro_for(&self, index: usize, raw: f64) -> Option<(usize, f64)> {
        let targets = self.targets.read().ok()?;
        let knob = targets.iter().position(|target| target.value == index)?;
        Some((knob, targets[knob].spec.position(raw)))
    }
}

unsafe impl Params for Macros {
    // TS: return this.knobs.map((knob, index) => [`macro${index + 1}`, knob, ""])  (id, param, group)
    fn param_map(&self) -> Vec<(String, ParamPtr, String)> {
        self.knobs.iter().enumerate().map(|(index, knob)| (format!("macro{}", index + 1), knob.as_ptr(), String::new())).collect()
    }

    // TS: return new Map([["package", JSON.stringify(this.package)], ["rack", this.rack]])
    // `.ok().and_then(...)` gives None if the lock or the writing fails, and `.unwrap_or_default()` "".
    fn serialize_fields(&self) -> BTreeMap<String, String> {
        let package = self.package.lock().ok().and_then(|package| serde_json::to_string(&*package).ok()).unwrap_or_default();
        let rack = self.rack.lock().map(|rack| rack.clone()).unwrap_or_default();
        BTreeMap::from([(PACKAGE_FIELD.to_owned(), package), (RACK_FIELD.to_owned(), rack)])
    }

    // The host's project is opening, or a preset loading: the macros' values are already restored.
    // TS:
    //   const json = serialized.get("package"); if (json !== undefined && !this.load(json)) log the failure;
    //   this.rack = serialized.get("rack") ?? "";
    fn deserialize_fields(&self, serialized: &BTreeMap<String, String>) {
        if let Some(json) = serialized.get(PACKAGE_FIELD) {
            if self.load(json).is_none() {
                nice_error!("the saved device didn't load");
            }
        }
        if let Ok(mut rack) = self.rack.lock() {
            *rack = serialized.get(RACK_FIELD).cloned().unwrap_or_default();
        }
    }
}
