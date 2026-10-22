//! How a track's params and notes reach its plan (ARCH-10.1): what the bank's TypeScript hands over
//! with `eng_bind` straight after a load, so the per-event work happens here, the same in every host.
//!
//! - **Values** are the device's params as the param store holds them (raw, before any shaping),
//!   numbered by the bank: each name a plan's sources read gets one.
//! - **Sources** are the plan's param inputs, in its order: the value each reads, and how that value
//!   is shaped on the way in (a table, then scale and offset: `resolveNumber` in params/table.ts). A
//!   sample source takes its value, a sample slot, as it is.
//! - **Zones** pick which sample a note plays, by key and velocity (INST-36.6); their settings are
//!   numbers or values read through their own shaping.
//!
//! The words are f64s, each sent as two int32 words (low half first), so the arithmetic is the
//! TypeScript's, in doubles, and what reaches the engine is the same to the bit. bank/binding.ts
//! writes them:
//!
//!   values, sources, has zones (0 or 1), zones,
//!   each source: value, sample (0 or 1), smoothing ms (0 for none), then its shaping,
//!   each zone: sample value, root, low key, high key, low velocity, high velocity, start, end,
//!              trim start, trim end, tune, level, key tracking (each setting below but the velocities),
//!   each value's raw value, then each value's starting point (NaN for none: it starts at its value).
//!
//! A shaping is scale, offset, a count of points, then each point's input and output. A setting is 0
//! then a number, or 1 then a value and its shaping.
//!
//! Binding happens with a load, off the audio thread's hot path, so it may allocate; starting a note
//! (`Binding::start`) doesn't.
//!
//! Rust notes, for reading this file:
//! - `.collect::<Option<Vec<_>>>()` turns a list of Options into an Option of a list: None if any
//!   was None. TS has no one-liner for it.
//! - `enum Setting { Fixed(f64), Bound(usize, Shaping) }` is a TS discriminated union whose cases
//!   carry data; `match` reads it by case.

use super::sampler::Sample;

/// A value's shaping on the way to the engine: read off `table` if it has points, then scaled and
/// offset.
pub struct Shaping {
    scale: f64,
    offset: f64,
    table: Vec<(f64, f64)>,
}

impl Shaping {
    // TS: resolveNumber(raw, { scale, offset, table })
    pub fn resolve(&self, raw: f64) -> f64 {
        // TS: const looked = this.table.length === 0 ? raw : lookupTable(this.table, raw); return looked * this.scale + this.offset;
        // The last expression, with no `;`, is what the function returns.
        let looked = if self.table.is_empty() { raw } else { lookup(&self.table, raw) };
        looked * self.scale + self.offset
    }
}

/// Piecewise-linear between a table's points, clamped at both ends.
// TS: lookupTable(points, input)
fn lookup(points: &[(f64, f64)], input: f64) -> f64 {
    // TS: const [firstInput, firstOutput] = points[0]; if (input <= firstInput) return firstOutput;
    let (first_input, first_output) = points[0];
    if input <= first_input {
        return first_output;
    }
    // TS:
    //   const upper = points.findIndex(([pointInput]) => pointInput >= input);
    //   if (upper === -1) return points[points.length - 1][1];
    //   const [fromInput, fromOutput] = points[upper - 1]; const [toInput, toOutput] = points[upper];
    //   return fromOutput + ((input - fromInput) / (toInput - fromInput)) * (toOutput - fromOutput);
    // `position` is findIndex, giving None rather than -1; `match` takes each case. `.1` is a tuple's
    // second item, `[1]` in TS.
    match points.iter().position(|&(point_input, _)| point_input >= input) {
        None => points[points.len() - 1].1,
        Some(upper) => {
            let ((from_input, from_output), (to_input, to_output)) = (points[upper - 1], points[upper]);
            from_output + (input - from_input) / (to_input - from_input) * (to_output - from_output)
        }
    }
}

/// One of the plan's param sources.
pub struct Source {
    /// The value it reads.
    pub value: usize,
    /// A sample param: its value is a sample slot, set as it is and never ramped.
    pub sample: bool,
    pub shaping: Shaping,
    /// How long a change takes to reach its value, if longer than a block.
    pub smooth_ms: f64,
}

/// A zone setting: a number, or a value through its shaping.
// TS: type ZoneValue = number | ParamBinding
pub enum Setting {
    Fixed(f64),
    Bound(usize, Shaping),
}

impl Setting {
    // TS: zoneValue(setting, values)
    fn read(&self, values: &[f64]) -> f64 {
        // TS: return typeof setting === "number" ? setting : resolveNumber(values[setting.value], setting);
        // `match` on an enum names each case's data: `*value` reads the number out of the loan.
        match self {
            Setting::Fixed(value) => *value,
            Setting::Bound(value, shaping) => shaping.resolve(values[*value]),
        }
    }
}

/// A sample zone (format.ts's `Zone`, every setting filled in).
pub struct Zone {
    /// The value naming the sample it plays.
    sample: usize,
    root: Setting,
    keys: [Setting; 2],
    velocities: (f64, f64),
    start: Setting,
    end: Setting,
    /// Milliseconds cut off each end, on top of `start` and `end`.
    trim_start: Setting,
    trim_end: Setting,
    /// Semitones.
    tune: Setting,
    level: Setting,
    /// 1 to follow the keys, 0 to play at its own pitch whatever the key.
    keytrack: Setting,
}

/// How a note starts: the engine's note on, and the zone signals it sets if it plays a zone.
pub struct NoteStart {
    pub frequency: f32,
    pub velocity: f32,
    /// The sample slot, root, start and end (the voice signals SIGNAL_SAMPLE to SIGNAL_END).
    pub zone: Option<[f32; 4]>,
}

/// A key's frequency, in doubles (bank.ts's `frequencyOf`).
// TS: const frequencyOf = (note: number) => 440 * 2 ** ((note - 69) / 12);
pub fn frequency_of(note: f64) -> f64 {
    440.0 * 2f64.powf((note - 69.0) / 12.0)
}

/// JS's `Math.round`: halves go up, where Rust's `round` takes them away from zero.
// TS: Math.round(value)
fn round_like_js(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// What a track binds: its plan's sources and zones, and the values they read.
// `#[derive(Default)]` writes a `Binding::default()` with every field empty: no sources, no zones.
#[derive(Default)]
pub struct Binding {
    pub sources: Vec<Source>,
    /// None without zones: every note plays. With them, a note no zone fits doesn't sound.
    pub zones: Option<Vec<Zone>>,
    /// Each value's raw value now.
    pub values: Vec<f64>,
}

impl Binding {
    /// How `note` starts, or None if the plan has zones and none fits it. A zone's settings are read
    /// now: its tune and key tracking set the frequency, its level scales the velocity, and its trims,
    /// in milliseconds, move the start and end by the sample's length.
    // TS: the first half of bank.ts's startNote, from `zoneFor` to the eng_voice_signal calls.
    pub fn start(&self, note: i32, velocity: f64, samples: &[Option<Sample>]) -> Option<NoteStart> {
        let values = &self.values;
        // TS: if (!this.zones) return { frequency: frequencyOf(note), velocity, zone: undefined };
        // `let Some(x) = y else { ... }` names what's inside an Option, or runs the else (which must leave).
        let Some(zones) = &self.zones else {
            return Some(NoteStart { frequency: frequency_of(f64::from(note)) as f32, velocity: velocity as f32, zone: None });
        };
        // TS: const zone = zones.find((zone) => note >= lowKey && note <= highKey && velocity >= lowVelocity && velocity <= highVelocity);
        //     if (!zone) return undefined;
        // `f64::from(note)` widens the int to a double, which can't lose anything (`as` could, elsewhere).
        // The `?` after `find(...)` returns None from `start` if no zone fits.
        let note_value = f64::from(note);
        let zone = zones.iter().find(|zone| {
            let (low_key, high_key) = (round_like_js(zone.keys[0].read(values)), round_like_js(zone.keys[1].read(values)));
            let (low_velocity, high_velocity) = zone.velocities;
            note_value >= low_key && note_value <= high_key && velocity >= low_velocity && velocity <= high_velocity
        })?;
        // TS:
        //   const root = zoneValue(zone.root, values);
        //   const played = zoneValue(zone.keytrack, values) >= 0.5 ? note : root;
        //   const frequency = frequencyOf(played) * 2 ** (zoneValue(zone.tune, values) / 12);
        //   const sample = values[zone.param];
        let root = zone.root.read(values);
        let played = if zone.keytrack.read(values) >= 0.5 { note_value } else { root };
        let frequency = frequency_of(played) * 2f64.powf(zone.tune.read(values) / 12.0);
        let sample = values[zone.sample];
        // TS:
        //   const seconds = samples[sample]?.seconds() ?? 0;
        //   const perMs = seconds > 0 ? 1 / (1000 * seconds) : 0;
        // `.and_then(Option::as_ref)`: the slot exists, and holds a sample (each slot is an Option).
        let seconds = samples.get(sample as usize).and_then(Option::as_ref).map_or(0.0, Sample::seconds);
        let per_ms = if seconds > 0.0 { 1.0 / (1000.0 * seconds) } else { 0.0 };
        // TS:
        //   const start = Math.min(1, Math.max(0, zoneValue(zone.start) + zoneValue(zone.trimStart) * perMs));
        //   const end = Math.min(1, Math.max(start, zoneValue(zone.end) - zoneValue(zone.trimEnd) * perMs));
        let start = (zone.start.read(values) + zone.trim_start.read(values) * per_ms).clamp(0.0, 1.0);
        let end = (zone.end.read(values) - zone.trim_end.read(values) * per_ms).max(start).min(1.0);
        // TS: return { frequency, velocity: velocity * zoneValue(zone.level), zone: [sample, root, start, end] };
        // `as f32` narrows each double to the single precision the engine's signals use.
        Some(NoteStart {
            frequency: frequency as f32,
            velocity: (velocity * zone.level.read(values)) as f32,
            zone: Some([sample as f32, root as f32, start as f32, end as f32]),
        })
    }

    /// Read a binding from `eng_bind`'s words (f64s), with each value's starting point (NaN for
    /// none): None if they don't make one, or name a value that isn't there.
    pub fn parse(words: &[f64]) -> Option<(Binding, Vec<f64>)> {
        // TS:
        //   const reader = new Reader(words);
        //   reader.values = reader.count(); const sourceCount = reader.count(); const hasZones = reader.word() === 1; const zoneCount = reader.count();
        // Each `?` returns None from `parse` as soon as a read fails.
        let mut reader = Reader { words, at: 0, values: 0 };
        reader.values = reader.count()?;
        let source_count = reader.count()?;
        let has_zones = reader.word()? == 1.0;
        let zone_count = reader.count()?;
        // TS:
        //   const sources = Array.from({ length: sourceCount }, () => reader.source());
        //   const zones = Array.from({ length: zoneCount }, () => reader.zone());
        //   const values = Array.from({ length: reader.values }, () => reader.word());
        //   const from = Array.from({ length: reader.values }, () => reader.word());
        //   (each giving up with undefined if any read fails)
        let sources = (0..source_count).map(|_| reader.source()).collect::<Option<Vec<_>>>()?;
        let zones = (0..zone_count).map(|_| reader.zone()).collect::<Option<Vec<_>>>()?;
        let values = (0..reader.values).map(|_| reader.word()).collect::<Option<Vec<_>>>()?;
        let from = (0..reader.values).map(|_| reader.word()).collect::<Option<Vec<_>>>()?;
        // TS: return reader.at === words.length ? [{ sources, zones: hasZones ? zones : undefined, values }, from] : undefined;
        // Words left over mean they weren't written for this reader. `cond.then_some(x)` is `cond ? x : undefined`.
        (reader.at == words.len()).then_some((Binding { sources, zones: has_zones.then_some(zones), values }, from))
    }
}

/// Reads `eng_bind`'s words in turn. Each method gives None once they run out or don't fit.
// TS: a cursor over a Float64Array: { words, at } with a method per thing it reads.
// `<'a>` is a lifetime: the reader borrows `words` (`&'a [f64]`) and can't outlive them, which Rust
// checks when it compiles. TS has no equivalent: a reference there keeps what it points at alive.
struct Reader<'a> {
    words: &'a [f64],
    at: usize,
    /// How many values there are, once read: what a value number must be under.
    values: usize,
}

// `'_` says "whatever lifetime the reader has": the methods don't need to name it.
impl Reader<'_> {
    // TS: word() { if (this.at >= this.words.length) return undefined; return this.words[this.at++]; }
    // `*` reads the number out of the loan `get` gives.
    fn word(&mut self) -> Option<f64> {
        let word = *self.words.get(self.at)?;
        self.at += 1;
        Some(word)
    }

    /// A count or an index: a whole number from 0, and not absurdly big.
    // TS: const word = this.word(); return word !== undefined && Number.isInteger(word) && word >= 0 && word <= 1e6 ? word : undefined;
    fn count(&mut self) -> Option<usize> {
        let word = self.word()?;
        (word.fract() == 0.0 && (0.0..=1e6).contains(&word)).then_some(word as usize)
    }

    /// A value's number.
    // TS: const value = this.count(); return value !== undefined && value < this.values ? value : undefined;
    fn value(&mut self) -> Option<usize> {
        self.count().filter(|&value| value < self.values)
    }

    // TS:
    //   const scale = this.word(), offset = this.word(), points = this.count();
    //   const table = Array.from({ length: points }, () => [this.word(), this.word()]);
    //   return { scale, offset, table };
    fn shaping(&mut self) -> Option<Shaping> {
        let (scale, offset) = (self.word()?, self.word()?);
        let points = self.count()?;
        let table = (0..points).map(|_| Some((self.word()?, self.word()?))).collect::<Option<Vec<_>>>()?;
        Some(Shaping { scale, offset, table })
    }

    // TS: return { value: this.value(), sample: this.word() === 1, smoothMs: this.word(), shaping: this.shaping() };
    fn source(&mut self) -> Option<Source> {
        let value = self.value()?;
        let (sample, smooth_ms) = (self.word()? == 1.0, self.word()?);
        Some(Source { value, sample, smooth_ms, shaping: self.shaping()? })
    }

    // TS: return this.word() === 0 ? this.word() : { value: this.value(), ...this.shaping() };
    // `Setting::Fixed(x)` and `Setting::Bound(..)` make one case or the other of the enum.
    fn setting(&mut self) -> Option<Setting> {
        if self.word()? == 0.0 {
            return Some(Setting::Fixed(self.word()?));
        }
        let value = self.value()?;
        Some(Setting::Bound(value, self.shaping()?))
    }

    // TS: return { sample: this.value(), root: this.setting(), keys: [this.setting(), this.setting()], velocities: [this.word(), this.word()], start: this.setting(), ... };
    // Fields are read in the order they're written, which is the order the words come in.
    fn zone(&mut self) -> Option<Zone> {
        let sample = self.value()?;
        let root = self.setting()?;
        let keys = [self.setting()?, self.setting()?];
        let velocities = (self.word()?, self.word()?);
        Some(Zone {
            sample,
            root,
            keys,
            velocities,
            start: self.setting()?,
            end: self.setting()?,
            trim_start: self.setting()?,
            trim_end: self.setting()?,
            tune: self.setting()?,
            level: self.setting()?,
            keytrack: self.setting()?,
        })
    }
}
