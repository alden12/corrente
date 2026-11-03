//! Sample maps (INST-55): a sample made of regions, each its own recording for a range of keys and
//! velocities, the way SFZ describes an instrument. A slot holds audio or a map; a map's regions name
//! the slots their audio is in. When a note starts on a zone whose sample is a map, the map picks the
//! region for the note's key and velocity, and the voice plays that region's slot from its keycenter.
//!
//! - **Velocities are MIDI's 0 to 127**, as SFZ's `lovel` and `hivel` are, so a note's 0-to-1 velocity
//!   is rounded onto that scale before it's compared: ranges that meet (0-63, 64-127) leave no gap.
//! - **Round robin:** where several regions fit the same note (SFZ's `seq_length` alternates), they take
//!   turns, in the order the map lists them, so a repeated snare hit isn't the same recording each
//!   time. The turn is counted on the first region that fits, so two drums sharing a map each keep their
//!   own alternation.
//!
//! Rust notes, for reading this file:
//! - `Cell<u32>` is a value that can change behind a shared (read-only) reference, safe because it is
//!   only ever copied in and out, never lent. Picking a region happens while the engine is only reading
//!   its samples, and the turn still has to move on.

use std::cell::Cell;

use super::sampler::{MAX_SAMPLES, Sample};

/// The most regions one map may have: a piano sampled every few keys at a few velocities fits easily.
pub const MAX_REGIONS: usize = 512;

/// Words a region takes in `eng_sample_map`: slot, lokey, hikey, lovel, hivel, keycenter.
const REGION_WORDS: usize = 6;

/// One recording in a map, and the keys and velocities it plays.
pub struct Region {
    /// The slot its audio is in.
    pub slot: usize,
    low_key: i32,
    high_key: i32,
    low_velocity: i32,
    high_velocity: i32,
    /// The note it was recorded at (SFZ's `pitch_keycenter`): the root it plays from.
    pub keycenter: f64,
}

impl Region {
    // TS: fits(note, velocity) { return note >= this.lowKey && note <= this.highKey && velocity >= this.lowVelocity && velocity <= this.highVelocity }
    fn fits(&self, note: i32, velocity: i32) -> bool {
        (self.low_key..=self.high_key).contains(&note) && (self.low_velocity..=self.high_velocity).contains(&velocity)
    }
}

pub struct SampleMap {
    regions: Box<[Region]>,
    /// Each region's round-robin turn, counted on the first region that fits a note.
    turns: Box<[Cell<u32>]>,
}

impl SampleMap {
    /// A map from `eng_sample_map`'s words: REGION_WORDS for each region. None if they don't make
    /// whole regions, a region names a slot that doesn't exist, or a range is upside down.
    // TS: static parse(words) { if (words.length % 6 || words.length / 6 > MAX_REGIONS) return undefined; const regions = chunks(words, 6).map(...); return regions.every(valid) ? new SampleMap(regions) : undefined }
    pub fn parse(words: &[f64]) -> Option<SampleMap> {
        let whole = words.len() % REGION_WORDS == 0 && words.len() / REGION_WORDS <= MAX_REGIONS;
        if !whole || words.is_empty() {
            return None;
        }
        // `chunks_exact(n)` walks the list n at a time. `collect::<Option<_>>()` makes the whole list
        // None as soon as one region is.
        let regions = words
            .chunks_exact(REGION_WORDS)
            .map(|region| {
                let [slot, low_key, high_key, low_velocity, high_velocity, keycenter] = region.try_into().ok()?;
                let region = Region {
                    slot: slot as usize,
                    low_key: low_key as i32,
                    high_key: high_key as i32,
                    low_velocity: low_velocity as i32,
                    high_velocity: high_velocity as i32,
                    keycenter,
                };
                let valid = slot >= 0.0 && region.slot < MAX_SAMPLES && region.low_key <= region.high_key && region.low_velocity <= region.high_velocity;
                valid.then_some(region)
            })
            .collect::<Option<Box<[Region]>>>()?;
        let turns = regions.iter().map(|_| Cell::new(0)).collect();
        Some(SampleMap { regions, turns })
    }

    /// The region that plays `note` at `velocity` (0 to 1), taking the next turn where several fit.
    /// None where none does: the note doesn't sound.
    // TS:
    //   const midiVelocity = Math.round(velocity * 127);
    //   const fitting = this.regions.filter((region) => region.fits(note, midiVelocity)); if (!fitting.length) return undefined;
    //   const first = this.regions.indexOf(fitting[0]); const turn = this.turns[first]++; return fitting[turn % fitting.length];
    pub fn pick(&self, note: i32, velocity: f64) -> Option<&Region> {
        let velocity = (velocity * 127.0).round() as i32;
        let first = self.regions.iter().position(|region| region.fits(note, velocity))?;
        let fitting = self.regions[first..].iter().filter(|region| region.fits(note, velocity)).count();
        let turn = self.turns[first].get();
        self.turns[first].set(turn.wrapping_add(1));
        self.regions[first..].iter().filter(|region| region.fits(note, velocity)).nth(turn as usize % fitting)
    }
}

/// Everything a note can start from: each slot's audio, or its map.
pub struct Samples {
    pub audio: Vec<Option<Sample>>,
    pub maps: Vec<Option<SampleMap>>,
}

impl Samples {
    pub const fn new() -> Self {
        Samples { audio: Vec::new(), maps: Vec::new() }
    }
}
