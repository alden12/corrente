//! Corrente as a plugin (PLUGIN-2, PLUGIN-3): a device package played by the engine the app uses,
//! from the host's MIDI, with 16 macros as the host's params. No editor yet, so the host shows its own
//! controls for them, and the device is the one built in (device.json) or the one the host's project
//! saved.
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
mod package;
mod params;
#[cfg(test)]
mod tests;

use corrente_engine::BLOCK;
use device::Prepared;
use nice_plug::prelude::*;
use package::Package;
use params::Macros;
use std::sync::Arc;
use std::sync::atomic::Ordering;

/// The most note events gathered for one engine block; more are dropped.
const MAX_EVENTS: usize = 512;
/// The device a new instance plays: export.ts's output.
const BUILT_IN: &str = include_str!("../device.json");

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
    fn default() -> Self {
        Corrente::with_package(BUILT_IN).expect("device.json is export.ts's output")
    }
}

impl Corrente {
    /// A plugin playing `json`'s package from when it's activated; None for one it can't read.
    fn with_package(json: &str) -> Option<Self> {
        let package = Package::parse(json)?;
        Some(Self {
            params: Arc::new(Macros::new(json.to_owned(), &package)),
            device: None,
            retiring: None,
            output: [[0.0; BLOCK]; 2],
            position: 0,
            events: Vec::with_capacity(MAX_EVENTS),
        })
    }

    /// Build the saved package's device at `rate`, here and now (off the audio thread).
    fn load(&mut self, rate: f32) -> bool {
        self.params.rate.store(rate.to_bits(), Ordering::Release);
        let json = self.params.package.lock().map(|json| json.clone()).unwrap_or_default();
        let prepared = Package::parse(&json).and_then(|package| device::prepare(&package, rate, &self.params.knobs));
        // One built before this, at an older rate, is stale.
        if let Ok(mut incoming) = self.params.incoming.lock() {
            incoming.take();
        }
        self.device = prepared.map(Box::new);
        self.device.is_some()
    }

    /// Swap in a device built off the audio thread, if one is waiting, handing the old one back to be
    /// freed there. Never waits for a lock, and frees nothing.
    fn take_incoming(&mut self) {
        if let Some(old) = self.retiring.take() {
            self.retire(old);
        }
        if self.retiring.is_some() {
            return;
        }
        let Some(new) = self.params.incoming.try_lock().ok().and_then(|mut incoming| incoming.take()) else { return };
        if let Some(old) = std::mem::replace(&mut self.device, Some(new)) {
            self.retire(old);
        }
    }

    /// Hand a device back to be freed off the audio thread, or keep it to try next block.
    fn retire(&mut self, old: Box<Prepared>) {
        match self.params.retired.try_lock() {
            Ok(mut retired) if retired.is_none() => *retired = Some(old),
            _ => self.retiring = Some(old),
        }
    }

    /// Render the next block: send changed values, start and stop the notes gathered for it, tell
    /// the engine where the transport is, then keep its output to play out.
    fn render(&mut self, beat: f64, tempo: f32, playing: bool) {
        self.take_incoming();
        let Some(device) = self.device.as_deref_mut() else {
            self.events.clear();
            return;
        };
        for value in 0..device.sources.len() {
            let now = device.sources[value].now(&self.params.knobs);
            if now != device.sent[value] {
                device.sent[value] = now;
                if let Some(track) = device.engine.track_mut(0) {
                    track.set_value(value, now);
                }
            }
        }
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
        self.events.clear();
        device.engine.set_transport(beat, tempo, playing);
        device.engine.process();
        if let Some(track) = device.engine.track_mut(0) {
            for (channel, output) in self.output.iter_mut().enumerate() {
                if let Some(rendered) = track.output(channel) {
                    output.copy_from_slice(rendered);
                }
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

    // None yet, so the host shows its own controls for the params.
    type Editor = ();
    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    // Off the audio thread: building the device allocates.
    fn activate(&mut self, _layout: &AudioIOLayout, buffer: &BufferConfig, context: &mut impl ActivateContext<Self>) -> bool {
        context.set_latency_samples(BLOCK as u32);
        self.load(buffer.sample_rate)
    }

    // May be called on the audio thread: lets go of every key, cuts every voice and starts the block
    // over, allocating nothing.
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
        let mut next_event = context.next_event();
        for (index, mut samples) in buffer.iter_samples().enumerate() {
            while let Some(event) = next_event.filter(|event| event.timing() <= index as u32) {
                let gathered = match event {
                    // A key can be a wildcard (any note), which nothing here sends a single note for yet.
                    NoteEvent::NoteOn { key, velocity, .. } => key.number().map(|note| Event::On { note, velocity }),
                    NoteEvent::NoteOff { key, .. } => key.number().map(|note| Event::Off { note }),
                    _ => None,
                };
                if let Some(gathered) = gathered.filter(|_| self.events.len() < MAX_EVENTS) {
                    self.events.push((self.position, gathered));
                }
                next_event = context.next_event();
            }
            for (channel, sample) in samples.iter_mut().enumerate() {
                *sample = self.output[channel.min(1)][self.position];
            }
            self.position += 1;
            if self.position == BLOCK {
                self.position = 0;
                let transport = context.transport();
                let (beat, tempo) = (transport.pos_beats().unwrap_or(0.0), transport.tempo.unwrap_or(120.0) as f32);
                let playing = transport.playing;
                self.render(beat, tempo, playing);
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
