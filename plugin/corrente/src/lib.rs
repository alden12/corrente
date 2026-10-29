//! Corrente as a plugin (PLUGIN-2, PLUGIN-3): a device package played by the engine the app uses,
//! from the host's MIDI, with 16 macros as the host's params. The device is the one built in
//! (device.json), the one the host's project saved, or the one built in the plugin's window: the
//! app's device rack in a webview (editor.rs), which sends a package for each change.
//!
//! - **The engine** is the app's (`corrente_engine`, built natively by engine/native), owned by the
//!   plugin, one per instance. A package carries a plan already compiled by the app's compiler, so no
//!   TypeScript runs here.
//! - **A device is built off the audio thread** (device.rs: loading allocates), in `activate`, or when
//!   the host restores a saved package (params.rs), and handed over whole: the audio thread swaps it
//!   in between blocks, and hands the old one back to be freed elsewhere.
//! - **Blocks:** the engine renders 128 samples at a time and hosts hand over any number, so the
//!   plugin runs a block behind. Each host sample plays a sample of the block rendered last, while
//!   its notes are gathered for the next one at the same place in it. That is 128 samples of latency,
//!   reported to the host, which makes up for it, and every note still lands on its own sample.
//! - **Voices, sample zones and param shaping** are the engine's (ARCH-10.1): the plugin hands it
//!   notes by key and params by their raw value, as the app's bank does.
//!
//! Rust notes, for reading this file:
//! - `impl Plugin for Corrente` implements nice-plug's interface (a TS `implements`); the `const`s
//!   are values it asks for, fixed at compile time.
//! - `Vec::with_capacity(n)` reserves room for n items up front: pushing up to n then never
//!   allocates, which is how the event queue stays off the allocator on the audio thread.
//! - `std::mem::replace(&mut a, b)` puts b in a and gives back what a held, in one step.

mod device;
mod editor;
mod package;
mod params;
#[cfg(test)]
mod tests;

use corrente_engine::BLOCK;
use device::Prepared;
use nice_plug::prelude::*;
use params::Macros;
use std::sync::Arc;
use std::sync::atomic::Ordering;

/// The most note events gathered for one engine block; more are dropped.
const MAX_EVENTS: usize = 512;
/// The device a new instance plays: export.ts's output.
const BUILT_IN: &str = include_str!("../device.json");

/// The beat at the start of the engine block about to render, `index` samples into the host's buffer
/// (whose start is at `at_buffer`): the block holds the events gathered over the BLOCK samples up to
/// and including `index`, so it starts BLOCK - 1 samples back, perhaps in the buffer before. Inside
/// the host's loop it wraps, as the host's own beat would have.
// TS:
//   const beat = atBuffer + (index + 1 - BLOCK) * perSample;
//   if (!loop || atBuffer < loop[0] || atBuffer >= loop[1] || loop[1] <= loop[0]) return beat;
//   return loop[0] + mod(beat - loop[0], loop[1] - loop[0]);
pub(crate) fn block_beat(at_buffer: f64, index: usize, per_sample: f64, looping: Option<(f64, f64)>) -> f64 {
    let beat = at_buffer + (index as f64 + 1.0 - BLOCK as f64) * per_sample;
    match looping {
        Some((start, end)) if end > start && (start..end).contains(&at_buffer) => start + (beat - start).rem_euclid(end - start),
        _ => beat,
    }
}

// TS: type Event = { kind: "on"; note: number; velocity: number } | { kind: "off"; note: number }
// `#[derive(Clone, Copy)]` lets an Event be copied like a number, rather than moved.
#[derive(Clone, Copy)]
enum Event {
    On { note: u8, velocity: f32 },
    Off { note: u8 },
}

pub struct Corrente {
    params: Arc<Macros>,
    /// The device playing, once the plugin is active.
    device: Option<Box<Prepared>>,
    /// A device swapped out that couldn't be handed back yet (the slot was busy): tried again next block.
    retiring: Option<Box<Prepared>>,
    /// The block rendered last, left and right, played out sample by sample.
    output: [[f32; BLOCK]; 2],
    /// How far into the block the host has reached: where the next sample plays from `output`, and
    /// where notes arriving now start in the next block.
    position: usize,
    /// Notes for the next block, at their place in it.
    events: Vec<(usize, Event)>,
}

impl Default for Corrente {
    // TS: return Corrente.withPackage(BUILT_IN) ?? throw new Error(...). `.expect` stops with that
    // message on None: the built-in package is ours, so it always reads.
    fn default() -> Self {
        Corrente::with_package(BUILT_IN).expect("device.json is export.ts's output")
    }
}

impl Corrente {
    /// A plugin playing `json`'s package from when it's activated; None for one it can't read.
    // TS: const package = Package.parse(json); if (!package) return undefined; return { params: new Macros(package), ... }
    fn with_package(json: &str) -> Option<Self> {
        let package = package::Package::parse(json)?;
        Some(Self {
            params: Arc::new(Macros::new(package)),
            device: None,
            retiring: None,
            output: [[0.0; BLOCK]; 2],
            position: 0,
            events: Vec::with_capacity(MAX_EVENTS),
        })
    }

    /// Build the saved package's device at `rate`, here and now (off the audio thread).
    fn load(&mut self, rate: f32) -> bool {
        // TS: this.params.rate = rate; this.params.previewing = false; const prepared = prepare(this.params.package, rate, [this.params.knobs, this.params.targets]);
        // An atomic holds a number, so the rate is stored as its bits. `.lock()` waits for the
        // mutex and lends what it guards; `.ok()` turns a failed lock into None.
        self.params.rate.store(rate.to_bits(), Ordering::Release);
        self.params.previewing.store(false, Ordering::Release);
        let prepared = self.params.package.lock().ok().zip(self.params.targets.read().ok()).and_then(|(package, targets)| device::prepare(&package, rate, Some((&self.params.knobs, &targets))));
        // One built before this, at an older rate, is stale, and so are changes waiting for it: the
        // package already has them.
        // TS: this.params.incoming = undefined; this.params.changes = [];  (`.take()` empties an Option)
        if let Ok(mut incoming) = self.params.incoming.lock() {
            incoming.take();
        }
        if let Ok(mut changes) = self.params.changes.lock() {
            changes.clear();
        }
        // TS: this.device = prepared; return prepared !== undefined;  (`Box::new` puts it on the heap)
        self.device = prepared.map(Box::new);
        self.device.is_some()
    }

    /// Swap in a device built off the audio thread, if one is waiting, handing the old one back to be
    /// freed there. Never waits for a lock, and frees nothing.
    fn take_incoming(&mut self) {
        // TS: const old = this.retiring; this.retiring = undefined; if (old) this.retire(old); if (this.retiring) return;
        if let Some(old) = self.retiring.take() {
            self.retire(old);
        }
        if self.retiring.is_some() {
            return;
        }
        // TS: const fresh = this.params.incoming.tryTake(); if (!fresh) return;
        // `try_lock` gives the lock only if it's free right now, never waiting: the audio thread can't.
        let Some(new) = self.params.incoming.try_lock().ok().and_then(|mut incoming| incoming.take()) else { return };
        // TS: const old = this.device; this.device = fresh; if (old) this.retire(old);
        if let Some(old) = std::mem::replace(&mut self.device, Some(new)) {
            self.retire(old);
        }
    }

    /// Hand a device back to be freed off the audio thread, or keep it to try next block.
    // TS: if (this.params.retired.tryLock() && !this.params.retired.value) this.params.retired.value = old; else this.retiring = old;
    // A `match` arm can carry a condition (`if retired.is_none()`); the `_` arm takes everything else.
    fn retire(&mut self, old: Box<Prepared>) {
        match self.params.retired.try_lock() {
            Ok(mut retired) if retired.is_none() => *retired = Some(old),
            _ => self.retiring = Some(old),
        }
    }

    /// Render the next block: take the window's changes, send changed values, start and stop the
    /// notes gathered for it, tell the engine where the transport is, then keep its output to play out.
    fn render(&mut self, beat: f64, tempo: f32, playing: bool) {
        // TS: this.takeIncoming(); const device = this.device; if (!device) { this.events.length = 0; return; }
        // `.as_deref_mut()` lends what's inside the Option<Box<..>> writably, without taking it out.
        self.take_incoming();
        let Some(device) = self.device.as_deref_mut() else {
            self.events.clear();
            return;
        };
        // TS:
        //   if (!this.params.incoming.busyOrFull() && !this.params.previewing) {
        //     const changes = this.params.changes.tryTake();
        //     changes?.forEach(([index, raw]) => device.set(index, raw, this.params.knobs));
        //   }
        // Changes made after a new device was built are that device's, so they wait while one is
        // waiting to swap in, and while a sound Explore tries plays (the saved package has them, and
        // plays again with them after). Neither lock is waited for; `.clear()` keeps the list's room.
        let waiting = self.params.incoming.try_lock().map(|incoming| incoming.is_some()).unwrap_or(true);
        if !waiting && !self.params.previewing.load(Ordering::Acquire) {
            if let Ok(mut changes) = self.params.changes.try_lock() {
                changes.iter().for_each(|&(index, raw)| device.set(index, raw, &self.params.knobs));
                changes.clear();
            }
        }
        // TS:
        //   device.sources.forEach((source, value) => {
        //     const now = source.now(this.params.knobs);
        //     if (now !== device.sent[value]) { device.sent[value] = now; device.engine.track(0)?.setValue(value, now); }
        //   });
        for value in 0..device.sources.len() {
            let now = device.sources[value].now(&self.params.knobs);
            if now != device.sent[value] {
                device.sent[value] = now;
                if let Some(track) = device.engine.track_mut(0) {
                    track.set_value(value, now);
                }
            }
        }
        // TS: for (const [offset, event] of this.events) event.kind === "on" ? engine.keyOn(...) : track.keyOff(...)
        // `&(offset, event)` unpacks each pair as it's lent out; `i32::from(note)` widens the u8 key.
        for &(offset, event) in &self.events {
            match event {
                Event::On { note, velocity } => device.engine.key_on(0, offset as i32, i32::from(note), f64::from(velocity)),
                Event::Off { note } => {
                    if let Some(track) = device.engine.track_mut(0) {
                        track.key_off(offset as i32, i32::from(note));
                    }
                }
            }
        }
        // TS: this.events.length = 0; engine.setTransport(beat, tempo, playing); engine.process();
        // `clear()` empties the list but keeps its room, so the next block's pushes don't allocate.
        self.events.clear();
        device.engine.set_transport(beat, tempo, playing);
        device.engine.process();
        // TS: this.output.forEach((output, channel) => output.set(track.output(channel)))
        if let Some(track) = device.engine.track_mut(0) {
            for (channel, output) in self.output.iter_mut().enumerate() {
                if let Some(rendered) = track.output(channel) {
                    output.copy_from_slice(rendered);
                }
            }
        }
    }
}

impl Corrente {
    /// Play the notes the window's keys played since the last buffer, at its start (PLUGIN-3.11).
    /// They aren't sent out to the host: Live doesn't take a VST3 instrument's MIDI out, so a host
    /// can't record them yet. Never waits for the lock.
    // TS:
    //   const played = this.params.played.tryTake(); if (!played) return;
    //   for (const [note, velocity] of played)
    //     if (this.events.length < MAX_EVENTS)
    //       this.events.push([this.position, velocity > 0 ? { kind: "on", note, velocity } : { kind: "off", note }]);
    // `drain(..)` takes every item out of the list, keeping its room.
    fn take_played(&mut self) {
        let Ok(mut played) = self.params.played.try_lock() else { return };
        for (note, velocity) in played.drain(..) {
            let event = if velocity > 0.0 { Event::On { note, velocity } } else { Event::Off { note } };
            if self.events.len() < MAX_EVENTS {
                self.events.push((self.position, event));
            }
        }
    }
}

impl Plugin for Corrente {
    const NAME: &'static str = "Corrente";
    const VENDOR: &'static str = "Corrente";
    const URL: &'static str = "https://corrente.cloud";
    const EMAIL: &'static str = "hello@corrente.cloud";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];
    const MIDI_INPUT: MidiConfig = MidiConfig::Basic;

    type Editor = editor::RackEditor;
    type SysExMessage = ();
    type BackgroundTask = ();

    // TS: return this.params. `Arc` is a shared pointer counted across threads; `.clone()` adds an
    // owner rather than copying the macros.
    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    // TS: return new RackEditor(this.params)
    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Self::Editor> {
        Some(editor::RackEditor::new(self.params.clone()))
    }

    // Off the audio thread: building the device allocates.
    fn activate(&mut self, _layout: &AudioIOLayout, buffer: &BufferConfig, context: &mut impl ActivateContext<Self>) -> bool {
        // TS: context.setLatencySamples(BLOCK); return this.load(buffer.sampleRate);
        context.set_latency_samples(BLOCK as u32);
        self.load(buffer.sample_rate)
    }

    // May be called on the audio thread: lets go of every key, cuts every voice and starts the block
    // over, allocating nothing.
    // TS:
    //   const track = this.device?.engine.track(0);
    //   if (track) { track.keysOff(0); for (let slot = 0; slot < track.voiceSlots(); slot++) track.cut(slot, 0); }
    //   this.events.length = 0; this.position = 0; this.output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    fn reset(&mut self) {
        if let Some(track) = self.device.as_deref_mut().and_then(|device| device.engine.track_mut(0)) {
            track.keys_off(0);
            (0..track.voice_slots()).for_each(|slot| track.cut(slot, 0));
        }
        self.events.clear();
        self.position = 0;
        self.output = [[0.0; BLOCK]; 2];
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, context: &mut impl ProcessContext<Self>) -> ProcessStatus {
        // TS: this.takePlayed()
        self.take_played();
        // TS: for each sample index: take every MIDI event timed at or before it, then play out one sample.
        // `while let Some(x) = ...` loops for as long as the expression gives a value.
        let mut next_event = context.next_event();
        for (index, mut samples) in buffer.iter_samples().enumerate() {
            while let Some(event) = next_event.filter(|event| event.timing() <= index as u32) {
                let gathered = match event {
                    // A key can be a wildcard (any note), which nothing here sends a single note for yet.
                    NoteEvent::NoteOn { key, velocity, .. } => key.number().map(|note| Event::On { note, velocity }),
                    NoteEvent::NoteOff { key, .. } => key.number().map(|note| Event::Off { note }),
                    _ => None,
                };
                // TS: if (gathered && this.events.length < MAX_EVENTS) this.events.push([this.position, gathered]);
                if let Some(gathered) = gathered.filter(|_| self.events.len() < MAX_EVENTS) {
                    self.events.push((self.position, gathered));
                }
                next_event = context.next_event();
            }
            // TS: samples.forEach((_, channel) => samples[channel] = this.output[Math.min(channel, 1)][this.position]);
            // `*sample = ...` writes through the loan `iter_mut` gives.
            for (channel, sample) in samples.iter_mut().enumerate() {
                *sample = self.output[channel.min(1)][self.position];
            }
            // TS: if (++this.position === BLOCK) { this.position = 0; this.render(transport's beat, tempo, playing) }
            self.position += 1;
            if self.position == BLOCK {
                self.position = 0;
                let transport = context.transport();
                let tempo = transport.tempo.unwrap_or(120.0);
                let at_buffer = transport.pos_beats().unwrap_or(0.0);
                let beat = block_beat(at_buffer, index, tempo / 60.0 / f64::from(transport.sample_rate), transport.loop_range_beats());
                self.render(beat, tempo as f32, transport.playing);
            }
        }
        ProcessStatus::KeepAlive
    }
}

impl ClapPlugin for Corrente {
    const CLAP_ID: &'static str = "cloud.corrente.corrente";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("Corrente's instruments, in any DAW");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::Instrument, ClapFeature::Synthesizer];
}

impl Vst3Plugin for Corrente {
    const VST3_CLASS_ID: [u8; 16] = *b"CorrenteInstrumt";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Instrument, Vst3SubCategory::Synth];
}

nice_export_clap!(Corrente);
nice_export_vst3!(Corrente);
