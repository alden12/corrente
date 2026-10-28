//! A device ready to play: an engine with a package's plan loaded and bound, its samples in their
//! slots, and where each of the binding's values comes from. Built off the audio thread (loading
//! allocates), then handed to it whole.
//!
//! Rust notes, for reading this file:
//! - `Box<T>` is a value on the heap behind one pointer: handing a `Box<Prepared>` between threads
//!   moves a pointer, not the engine.

use crate::package::{Package, ParamSpec, Value, audio_of};
use crate::params::targets_of;
use corrente_engine::Engine;
use nice_plug::prelude::*;

/// The sample slot a sample param with no sample points at (the app's EMPTY_SAMPLE).
const EMPTY_SAMPLE: usize = 255;

/// Where one of the binding's values comes from.
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

/// An engine at `rate` playing `package`, its values read from `knobs` now. With no knobs (a sound
/// Explore is trying), no macros: the package's own values play. None for a plan or binding the
/// engine refuses.
pub fn prepare(package: &Package, rate: f32, knobs: Option<&[FloatParam]>) -> Option<Prepared> {
    // TS: const engine = new Engine(); engine.init(rate, 1);
    let mut engine = Engine::new();
    engine.init(rate as i32, 1);
    // TS:
    //   let nextSlot = 0;
    //   const sources = package.values.map((value) => value.kind === "sample" ? fixed(slot it loads into, or EMPTY_SAMPLE) : fixed(value.raw));
    // The closure changes `engine` and `next_slot` as `map` calls it: fine in Rust because nothing
    // else uses them meanwhile. `Value::Fixed { raw } | Value::Param { raw, .. }` matches either case.
    // Each sample takes the next slot; one that won't load plays silence, as in the app.
    let mut next_slot = 0;
    let mut sources: Vec<Source> = package
        .values
        .iter()
        .map(|value| match value {
            Value::Fixed { raw } | Value::Param { raw, .. } => Source::Fixed(*raw),
            Value::Sample { file, table } => {
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
    // TS: if (knobs) targetsOf(package).forEach((target, knob) => sources[target.value] = macro(knob, target, still: position(target.raw)));
    // `knobs.map_or(0, ...)` is how many there are, or 0 with none: `take(0)` maps nothing.
    for (knob, target) in targets_of(package).into_iter().enumerate().take(knobs.map_or(0, |knobs| knobs.len())) {
        let still = target.spec.position(target.raw) as f32;
        sources[target.value] = Source::Macro { knob, spec: target.spec, raw: target.raw, still };
    }
    // TS: const plan = parsePlan(package.words); if (!plan) return undefined; if (!engine.load(0, plan)) { log; return undefined }
    let plan = corrente_engine::parse_plan(&package.words).ok()?;
    if !engine.load(0, plan) {
        nice_error!("the engine refused {}'s plan", package.label);
        return None;
    }
    // The binding, then each value now, then where each starts: NaN, at its value.
    // TS:
    //   const sent = sources.map((source) => source.now(knobs ?? []));
    //   return engine.bind(0, [...package.binding, ...sent, ...sent.map(() => NaN)]) ? { engine, sources, sent } : undefined;
    // `[a, b, c].concat()` joins three slices into one new list.
    let sent: Vec<f64> = sources.iter().map(|source| source.now(knobs.unwrap_or_default())).collect();
    let starts = vec![f64::NAN; sent.len()];
    engine.bind(0, &[&package.binding[..], &sent, &starts].concat()).then_some(Prepared { engine, sources, sent })
}
