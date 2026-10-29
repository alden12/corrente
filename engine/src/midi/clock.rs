//! The clock node: ticks on a grid of steps, locked to the transport (INST-11.1's spike showed this
//! holds in the app and in Ableton).
//!
//! - **It keeps no count.** Each block works out which steps fall inside it from the beat at its start,
//!   so a loop jumping back, or a seek, just lands on other steps. All it remembers is the last step it
//!   ticked, so a step on a block's edge isn't ticked twice, whichever side the host's beat rounds to.
//! - **Stopped, it free-runs** on a beat of its own, which the first note held on its `sync` input
//!   starts on a step, so an arpeggio starts as the key goes down.

use super::{BlockTransport, Event, MAX_EVENTS, Timed};
use crate::router::BLOCK;

// TS: class Clock { last?: [step: number, playing: boolean]; freeBeat = 0; held = 0 }
pub struct Clock {
    /// The last step ticked, and whether the transport was playing then (stopped counts on its own beat).
    last: Option<(i64, bool)>,
    /// The beat it free-runs on while stopped, at the start of the coming block.
    free_beat: f64,
    /// How many notes are down on `sync`.
    held: usize,
}

impl Clock {
    // TS: new Clock()
    pub fn new() -> Self {
        Clock { last: None, free_beat: 0.0, held: 0 }
    }

    /// The block's ticks, `step_beats` apart, merged in sample order with the notes on `sync` (a note
    /// landing with a tick goes first, so a tick it starts falls on it).
    // TS: process(sync, transport, stepBeats, out)
    pub fn process(&mut self, sync: &[Timed], transport: BlockTransport, step_beats: f64, out: &mut Vec<Timed>) {
        let step_beats = step_beats.max(1e-6);
        let per_sample = transport.per_sample.max(1e-12);
        let samples = step_beats / per_sample;
        let mut position = 0;
        let mut next_note = 0;
        // TS: while (position < BLOCK) { take whichever comes first: a note on sync, or a tick }
        // Each turn takes a note or moves `position` on, so it ends.
        while position < BLOCK {
            let base = if transport.playing { transport.beat } else { self.free_beat };
            let tick = self.next_tick(base, per_sample, position, step_beats, transport.playing);
            let note = sync.get(next_note).copied();
            match (note, tick) {
                (Some((offset, event)), _) if tick.is_none_or(|(at, _)| offset <= at) => {
                    next_note += 1;
                    self.take(offset, event, transport.playing, per_sample);
                }
                (_, Some((offset, step))) => {
                    self.last = Some((step, transport.playing));
                    if out.len() < MAX_EVENTS {
                        out.push((offset, Event::Tick { step, samples, level: 1.0 }));
                    }
                    position = offset + 1;
                }
                _ => break,
            }
        }
        // TS: this.freeBeat += BLOCK * perSample
        self.free_beat += BLOCK as f64 * per_sample;
    }

    /// The first step at or after `position`: its offset and number, or None if it's past the block.
    // TS: let step = Math.ceil(beatAt(position) / stepBeats - 1e-9); if it's the last ticked, step++; offset = Math.round((step * stepBeats - base) / perSample)
    fn next_tick(&self, base: f64, per_sample: f64, position: usize, step_beats: f64, playing: bool) -> Option<(usize, i64)> {
        let beat = base + position as f64 * per_sample;
        let mut step = (beat / step_beats - 1e-9).ceil() as i64;
        if self.last == Some((step, playing)) {
            step += 1;
        }
        let offset = ((step as f64 * step_beats - base) / per_sample).round();
        // `as usize` on a negative float gives 0, so it's raised to `position` first.
        let offset = offset.max(position as f64) as usize;
        (offset < BLOCK).then_some((offset, step))
    }

    /// A note on `sync`. The first held while stopped starts the free-running beat on a step, here.
    /// A note with a length (another arpeggio's step) has no note off to come, so it isn't counted.
    // TS: if (on && !length) { if (!this.held && !playing) { this.freeBeat = -offset * perSample; this.last = undefined } this.held++ } else if (off) this.held = Math.max(0, this.held - 1)
    fn take(&mut self, offset: usize, event: Event, playing: bool, per_sample: f64) {
        match event {
            Event::On { length: None, .. } => {
                if self.held == 0 && !playing {
                    self.free_beat = -(offset as f64) * per_sample;
                    self.last = None;
                }
                self.held += 1;
            }
            Event::Off { .. } => self.held = self.held.saturating_sub(1),
            _ => {}
        }
    }

    /// Forget what's held: the chain was let go.
    // TS: this.held = 0
    pub fn clear(&mut self) {
        self.held = 0;
    }
}
