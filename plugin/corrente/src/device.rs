//! A device ready to play: an engine with a package's plan loaded and bound, its samples in their
//! slots, its MIDI devices ahead of it (PLUGIN-3.8), and where each value comes from. Built off the audio thread (loading
//! allocates), then handed to it whole.
//!
//! Rust notes, for reading this file:
//! - `Box<T>` is a value on the heap behind one pointer: handing a `Box<Prepared>` between threads
//!   moves a pointer, not the engine.

use crate::package::{Package, ParamSpec, Value, audio_of};
use crate::params::Target;
use corrente_engine::Engine;
use nice_plug::prelude::*;

/// The sample slot a sample param with no sample points at (the app's EMPTY_SAMPLE).
const EMPTY_SAMPLE: usize = 255;

/// Where one of the package's values comes from: the binding's, or the MIDI devices' after them.
pub enum Source {
    /// A number that stays put: a sample's slot, an effect's bypass, a param no macro is mapped to.
    Fixed(f64),
    /// A macro's knob. Until it moves off where the package left it (`still`), the package's own value
    /// plays, exactly; then the knob's position through the param's spec.
    Macro { knob: usize, spec: ParamSpec, raw: f64, still: f32 },
}

impl Source {
    /// The value's raw engine value now.
    // TS:
    //   if (this.kind === "fixed") return this.raw;
    //   const position = knobs[this.knob].value;
    //   return position === this.still ? this.raw : this.spec.engineValue(position);
    // `*raw` reads the number out of the loan the pattern gives.
    pub fn now(&self, knobs: &[FloatParam]) -> f64 {
        match self {
            Source::Fixed(raw) => *raw,
            Source::Macro { knob, spec, raw, still } => {
                let position = knobs[*knob].value();
                if position == *still { *raw } else { spec.engine_value(f64::from(position)) }
            }
        }
    }
}

pub struct Prepared {
    pub engine: Engine,
    pub sources: Vec<Source>,
    /// What each value was last set to, so only changes are sent.
    pub sent: Vec<f64>,
    /// How many of the values are the binding's: the rest are the MIDI devices'.
    pub bound: usize,
}

impl Prepared {
    /// Set value `index` in the engine: the binding's, or a MIDI device's past them.
    // TS: index < this.bound ? track.setValue(index, raw) : track.setMidiValue(index - this.bound, raw);
    pub fn send(&mut self, index: usize, raw: f64) {
        let bound = self.bound;
        if let Some(track) = self.engine.track_mut(0) {
            match index.checked_sub(bound) {
                None => track.set_value(index, raw),
                Some(midi) => track.set_midi_value(midi, raw),
            }
        }
    }
}

impl Prepared {
    /// The window moved value `index` to `raw`: a fixed value takes it; a macro's plays it from now,
    /// until its knob moves again. Allocates nothing: the audio thread calls it between blocks.
    // TS:
    //   const source = this.sources[index];
    //   if (source?.kind === "fixed") source.raw = raw;
    //   else if (source?.kind === "macro") { source.raw = raw; source.still = knobs[source.knob].value; }
    // `get_mut(i)` lends the item at i writably, if there is one; `raw: value` names that field `value`.
    pub fn set(&mut self, index: usize, raw: f64, knobs: &[FloatParam]) {
        match self.sources.get_mut(index) {
            Some(Source::Fixed(value)) => *value = raw,
            Some(Source::Macro { knob, raw: value, still, .. }) => {
                *value = raw;
                *still = knobs[*knob].value();
            }
            None => {}
        }
    }
}

/// An engine at `rate` playing `package`, the values `targets` names read from their `knobs` now.
/// With no macros (a sound Explore is trying), the package's own values play. None for a plan or
/// binding the engine refuses.
pub fn prepare(package: &Package, rate: f32, macros: Option<(&[FloatParam], &[Option<Target>])>) -> Option<Prepared> {
    let (knobs, targets) = macros.unwrap_or_default();
    // TS: const engine = new Engine(); engine.init(rate, 1);
    let mut engine = Engine::new();
    engine.init(rate as i32, 1);
    // TS:
    //   let nextSlot = 0;
    //   const sources = package.allValues().map((value) => value.kind === "sample" ? fixed(slot it loads into, or EMPTY_SAMPLE) : fixed(value.raw));
    // The closure changes `engine` and `next_slot` as `map` calls it: fine in Rust because nothing
    // else uses them meanwhile. `Value::Fixed { raw } | Value::Param { raw, .. }` matches either case.
    // Each sample takes the next slot; one that won't load plays silence, as in the app.
    let mut next_slot = 0;
    let mut sources: Vec<Source> = package
        .all_values()
        .map(|value| match value {
            Value::Fixed { raw } | Value::Param { raw, .. } => Source::Fixed(*raw),
            Value::Sample { file, table, .. } => {
                let audio = audio_of(file.as_deref(), table.as_deref());
                // TS: reserve the slot, copy each channel in after the one before, then count it taken.
                // `data[a..b]` is a slice (subarray) of the engine's memory; `copy_from_slice` is `set`.
                let slot = audio.filter(|_| next_slot < EMPTY_SAMPLE).and_then(|audio| {
                    let frames = audio.channels[0].len();
                    let data = engine.reserve_sample(next_slot, frames, audio.channels.len(), audio.rate)?;
                    audio.channels.iter().enumerate().for_each(|(channel, samples)| data[channel * frames..(channel + 1) * frames].copy_from_slice(&samples[..frames]));
                    next_slot += 1;
                    Some(next_slot - 1)
                });
                Source::Fixed(slot.unwrap_or(EMPTY_SAMPLE) as f64)
            }
        })
        .collect();
    // TS: targets.forEach((target, knob) => { if (target) sources[target.value] = macro(knob, target, still: position(target.raw)) });
    // `.filter_map` over the pairs skips the knobs with no target.
    for (knob, target) in targets.iter().enumerate().filter_map(|(knob, target)| target.as_ref().map(|target| (knob, target))) {
        let still = target.spec.position(target.raw) as f32;
        sources[target.value] = Source::Macro { knob, spec: target.spec.clone(), raw: target.raw, still };
    }
    // TS: const plan = parsePlan(package.words); if (!plan) return undefined; if (!engine.load(0, plan)) { log; return undefined }
    let plan = corrente_engine::parse_plan(&package.words).ok()?;
    if !engine.load(0, plan) {
        nice_error!("the engine refused {}'s plan", package.label);
        return None;
    }
    // The binding, then each of its values now, then where each starts: NaN, at its value.
    // TS:
    //   const sent = sources.map((source) => source.now(knobs)); const bound = package.values.length;
    //   if (!engine.bind(0, [...package.binding, ...sent.slice(0, bound), ...Array(bound).fill(NaN)])) return undefined;
    // `[a, b, c].concat()` joins three slices into one new list.
    let sent: Vec<f64> = sources.iter().map(|source| source.now(knobs)).collect();
    let bound = package.values.len();
    let starts = vec![f64::NAN; bound];
    if !engine.bind(0, &[&package.binding[..], &sent[..bound], &starts].concat()) {
        return None;
    }
    // The MIDI devices, ahead of the voices, then each of their values now: the chain's words carry the
    // values it was made with, and a value the window or a macro has moved since is the one to play.
    // TS:
    //   if (package.midi.length && !engine.loadMidi(0, package.midi)) { log; return undefined }
    //   if (package.key) engine.setKey(package.key.tonic, package.key.scale);
    if !package.midi.is_empty() && !engine.load_midi(0, &package.midi) {
        nice_error!("the engine refused {}'s MIDI devices", package.label);
        return None;
    }
    if let Some(key) = package.key {
        engine.set_key(key.tonic, key.scale);
    }
    let mut prepared = Prepared { engine, sources, sent, bound };
    // TS: prepared.sent.slice(bound).forEach((raw, midi) => prepared.send(bound + midi, raw));
    (bound..prepared.sent.len()).for_each(|index| prepared.send(index, prepared.sent[index]));
    Some(prepared)
}
