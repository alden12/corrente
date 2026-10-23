//! A device package (the app's src/audio/bank/devicePackage.ts): the plan, its binding, and every value
//! the binding reads, samples embedded. What the plugin plays, saves with the DAW's project, and loads
//! again with its window closed.
//!
//! Rust notes, for reading this file:
//! - `#[derive(Deserialize)]` has serde write the JSON reading for a struct; `#[serde(tag = "kind")]`
//!   reads a TS-style discriminated union by its `kind` field.
//! - `Option<T>` is a value that may be missing, like `T | undefined`.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Deserialize;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// The package format this plugin reads (devicePackage.ts's PACKAGE_FORMAT).
pub const FORMAT: u32 = 1;

#[derive(Deserialize)]
pub struct Package {
    pub format: u32,
    pub label: String,
    /// The compiled plan, as `eng_load` reads it.
    pub words: Vec<i32>,
    /// `eng_bind`'s words up to the values.
    pub binding: Vec<f64>,
    /// Each value the binding reads, in its order.
    pub values: Vec<Value>,
}

// TS: type PackageValue = { kind: "param", ... } | { kind: "sample", ... } | { kind: "fixed", ... }
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Value {
    Param { title: String, spec: ParamSpec, raw: f64 },
    Sample { file: Option<String>, table: Option<String> },
    Fixed { raw: f64 },
}

// TS: type ParamSpec = NumberSpec | EnumSpec | BooleanSpec  (src/audio/params/types.ts)
#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ParamSpec {
    Number { min: f64, max: f64, unit: Option<String>, taper: Option<String>, step: Option<f64> },
    Enum { options: Vec<String> },
    Boolean {},
}

impl ParamSpec {
    /// The engine value at a knob position from 0 to 1, as the app's knobs set it: a number through its
    /// taper (params/taper.ts's `fromNormalized`) and onto its step, a choice's index, a switch's 0 or 1.
    pub fn engine_value(&self, position: f64) -> f64 {
        // TS: const t = Math.min(1, Math.max(0, position)); switch on the spec's kind (`match` below).
        let position = position.clamp(0.0, 1.0);
        match self {
            // TS: const value = exponential ? Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))) : min + t * (max - min);
            //     return step > 0 ? Math.min(max, min + Math.round((value - min) / step) * step) : value;
            // `..` in a pattern skips the fields not named. `.filter(..).map_or(a, f)`: no usable step gives a.
            ParamSpec::Number { min, max, taper, step, .. } => {
                let value = if taper.as_deref() == Some("exponential") && *min > 0.0 && *max > 0.0 {
                    (min.ln() + position * (max.ln() - min.ln())).exp()
                } else {
                    min + position * (max - min)
                };
                step.filter(|&step| step > 0.0).map_or(value, |step| (min + ((value - min) / step).round() * step).min(*max))
            }
            // TS: return Math.round(t * (options.length - 1))
            ParamSpec::Enum { options } => (position * (options.len().max(1) - 1) as f64).round(),
            // TS: return t >= 0.5 ? 1 : 0
            ParamSpec::Boolean {} => f64::from(u8::from(position >= 0.5)),
        }
    }

    /// The knob position of an engine value: the inverse of `engine_value` (taper.ts's `toNormalized`).
    pub fn position(&self, value: f64) -> f64 {
        // TS: toNormalized(spec, value) for a number; index / (options - 1) for a choice; the value for a switch.
        // A `match` is an expression, so its result is assigned straight to `position`.
        let position = match self {
            ParamSpec::Number { min, max, taper, .. } => {
                let value = value.clamp(*min, *max);
                if taper.as_deref() == Some("exponential") && *min > 0.0 && *max > 0.0 {
                    (value.ln() - min.ln()) / (max.ln() - min.ln())
                } else {
                    (value - min) / (max - min)
                }
            }
            ParamSpec::Enum { options } => value / (options.len().max(2) - 1) as f64,
            ParamSpec::Boolean {} => value,
        };
        // TS: return Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : 0;
        if position.is_finite() { position.clamp(0.0, 1.0) } else { 0.0 }
    }

    /// An engine value as the host shows it: a number with its unit, a choice by name, a switch.
    pub fn display(&self, value: f64) -> String {
        match self {
            // TS: return `${value.toFixed(max - min > 100 ? 0 : 2)}${unit ? ` ${unit}` : ""}`;
            // `{value:.decimals$}` formats with `decimals` places, like toFixed(decimals).
            ParamSpec::Number { min, max, unit, .. } => {
                let decimals = if max - min > 100.0 { 0 } else { 2 };
                let unit = unit.as_deref().map(|unit| format!(" {unit}")).unwrap_or_default();
                format!("{value:.decimals$}{unit}")
            }
            // TS: return options[value] ?? "";   (`.cloned()` copies the string out of the list)
            ParamSpec::Enum { options } => options.get(value as usize).cloned().unwrap_or_default(),
            // TS: return value >= 0.5 ? "On" : "Off";   (`.to_owned()` makes an owned String from the text)
            ParamSpec::Boolean {} => (if value >= 0.5 { "On" } else { "Off" }).to_owned(),
        }
    }
}

/// Audio for one of the engine's sample slots: one or two channels of the same length, at its rate.
pub struct Audio {
    pub channels: Vec<Vec<f32>>,
    pub rate: f32,
}

impl Package {
    /// A package from its JSON, or None for one this plugin can't read.
    // TS: try { const package = JSON.parse(json); return package.format === FORMAT ? package : undefined } catch { return undefined }
    // `::<Package>` names the type serde should read; `.ok()` turns its error into None.
    pub fn parse(json: &str) -> Option<Package> {
        serde_json::from_str::<Package>(json).ok().filter(|package| package.format == FORMAT)
    }
}

/// A sample value's audio: its file decoded, or its table as it is. None for none, or one that won't
/// decode (it plays silence, as in the app).
pub fn audio_of(file: Option<&str>, table: Option<&str>) -> Option<Audio> {
    // TS: if (table) return { channels: [new Float32Array(base64Bytes(table).buffer)], rate: 48000 };
    // `chunks_exact(4)` walks the bytes four at a time; `f32::from_le_bytes` reads each as a float.
    if let Some(table) = table {
        let bytes = BASE64.decode(table).ok()?;
        let floats = bytes.chunks_exact(4).map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])).collect();
        // A table is read by the cycle, so its rate is never used.
        return Some(Audio { channels: vec![floats], rate: 48000.0 });
    }
    // TS: return file === undefined ? undefined : decode(base64Bytes(file));  (`file?` returns None for no file)
    decode(BASE64.decode(file?).ok()?)
}

/// A sound file's audio (WAV, FLAC, MP3, Ogg), its first two channels at its own rate.
fn decode(bytes: Vec<u8>) -> Option<Audio> {
    // TS: const format = probe(bytes) (which container: WAV, FLAC, ...); const track = format.defaultTrack;
    //     const decoder = codecs.make(track.codecParams);
    // `Box::new(Cursor::new(bytes))` wraps the bytes as a readable stream symphonia can seek in.
    let stream = MediaSourceStream::new(Box::new(std::io::Cursor::new(bytes)), Default::default());
    let probed = symphonia::default::get_probe().format(&Hint::new(), stream, &FormatOptions::default(), &MetadataOptions::default()).ok()?;
    let mut format = probed.format;
    let track = format.default_track()?;
    let (id, rate) = (track.id, track.codec_params.sample_rate? as f32);
    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()).ok()?;
    // TS:
    //   const channels: number[][] = [];
    //   for (let packet = format.nextPacket(); packet; packet = format.nextPacket()) {
    //     if (packet.trackId !== id) continue;
    //     const decoded = decoder.decode(packet); if (!decoded) continue;
    //     each of its first two channels' samples appended to that channel;
    //   }
    // `SampleBuffer` converts whatever the file stores (16-bit, 24-bit, ...) to f32s, planar: one
    // channel's samples, then the next's.
    let mut channels: Vec<Vec<f32>> = Vec::new();
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != id {
            continue;
        }
        let Ok(decoded) = decoder.decode(&packet) else { continue };
        let spec = *decoded.spec();
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buffer.copy_planar_ref(decoded);
        let count = spec.channels.count().min(2);
        let frames = buffer.samples().len() / spec.channels.count();
        channels.resize_with(count, Vec::new);
        for (channel, samples) in channels.iter_mut().enumerate() {
            samples.extend_from_slice(&buffer.samples()[channel * frames..(channel + 1) * frames]);
        }
    }
    // TS: return channels[0]?.length ? { channels, rate } : undefined;
    (!channels.is_empty() && !channels[0].is_empty()).then_some(Audio { channels, rate })
}
