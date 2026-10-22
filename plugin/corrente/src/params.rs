//! The device's params as the host's: a number as a float, a switch as a bool, a choice as an int
//! that shows its option's name. nice-plug's `#[derive(Params)]` needs them known when the plugin is
//! compiled; these come from the device, so `Params` is implemented by hand.
//!
//! Rust notes, for reading this file:
//! - `unsafe impl Params` is implementing a trait whose contract Rust can't check: here, that the
//!   pointers `param_map` hands out stay valid as long as the params do (they live in `self`).

use crate::device::ParamSpec;
use nice_plug::prelude::*;
use std::sync::Arc;

pub enum HostParam {
    Number(FloatParam),
    Switch(BoolParam),
    Choice(IntParam),
}

impl HostParam {
    fn from_spec(spec: &ParamSpec) -> Self {
        match spec {
            ParamSpec::Number { name, min, max, default, unit, taper, step, .. } => {
                let range = if taper.as_deref() == Some("exponential") && *min > 0.0 {
                    // The app's exponential taper puts the geometric mean at the middle; a skew that
                    // puts it there too follows it closely (nice-plug has no exponential range).
                    let middle = ((min * max).sqrt() - min) / (max - min);
                    FloatRange::Skewed { min: *min, max: *max, factor: 0.5f32.ln() / middle.ln() }
                } else {
                    FloatRange::Linear { min: *min, max: *max }
                };
                let unit = unit.clone().map(|unit| format!(" {unit}")).unwrap_or_default();
                let decimals = if max - min > 100.0 { 0 } else { 2 };
                let param = FloatParam::new(name, *default, range)
                    .with_value_to_string(Arc::new(move |value| format!("{value:.decimals$}{unit}")))
                    // Typed in, the number before any unit: "200 ms" or "200" both read as 200.
                    .with_string_to_value(Arc::new(|text| text.split_whitespace().next()?.parse().ok()));
                HostParam::Number(match step {
                    Some(step) => param.with_step_size(*step),
                    None => param,
                })
            }
            ParamSpec::Boolean { name, default, .. } => HostParam::Switch(BoolParam::new(name, *default)),
            ParamSpec::Enum { name, options, default, .. } => {
                let index = options.iter().position(|option| option == default).unwrap_or(0);
                let (names, names_back) = (options.clone(), options.clone());
                HostParam::Choice(
                    IntParam::new(name, index as i32, IntRange::Linear { min: 0, max: options.len() as i32 - 1 })
                        .with_value_to_string(Arc::new(move |index| names.get(index as usize).cloned().unwrap_or_default()))
                        .with_string_to_value(Arc::new(move |text| names_back.iter().position(|name| name == text).map(|index| index as i32))),
                )
            }
        }
    }

    /// The param's value as the engine reads it: a number as it is, a switch as 0 or 1, a choice as
    /// its option's index.
    // TS: engineValueOf(spec, value)  (src/audio/definitions/values.ts)
    pub fn engine_value(&self) -> f32 {
        match self {
            HostParam::Number(param) => param.value(),
            HostParam::Switch(param) => f32::from(u8::from(param.value())),
            HostParam::Choice(param) => param.value() as f32,
        }
    }

    fn pointer(&self) -> ParamPtr {
        match self {
            HostParam::Number(param) => param.as_ptr(),
            HostParam::Switch(param) => param.as_ptr(),
            HostParam::Choice(param) => param.as_ptr(),
        }
    }
}

pub struct DeviceParams {
    /// The device's params, in its order, with their ids (what the host saves them under).
    pub params: Vec<(String, HostParam)>,
}

impl DeviceParams {
    pub fn new(specs: &[ParamSpec]) -> Self {
        Self { params: specs.iter().map(|spec| (spec.id().to_owned(), HostParam::from_spec(spec))).collect() }
    }

    /// Where a param is in `params`, by id.
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.params.iter().position(|(param_id, _)| param_id == id)
    }
}

unsafe impl Params for DeviceParams {
    fn param_map(&self) -> Vec<(String, ParamPtr, String)> {
        self.params.iter().map(|(id, param)| (id.clone(), param.pointer(), String::new())).collect()
    }
}
