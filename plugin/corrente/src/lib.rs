//! Corrente as a plugin (PLUGIN-2's proof of concept): one built-in instrument, played by the
//! engine the app uses, from the host's MIDI, with its params as the host's. No editor yet, so the
//! host shows its own controls for them.
//!
//! - **The engine** is the app's (`corrente_engine`, built natively by engine/native), owned by the
//!   plugin, one per instance. The device's plan was compiled ahead of time by the app's compiler
//!   (export.ts -> device.json), so no TypeScript runs here.
//! - **The plan loads in `activate`**, which hosts call off the audio thread: loading allocates.
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

mod device;
mod params;
#[cfg(test)]
mod tests;

use corrente_engine::{BLOCK, Engine};
use device::Device;
use nice_plug::prelude::*;
use params::DeviceParams;
use std::sync::Arc;

/// The most note events gathered for one engine block; more are dropped.
const MAX_EVENTS: usize = 512;

#[derive(Clone, Copy)]
enum Event {
    On { note: u8, velocity: f32 },
    Off { note: u8 },
}

pub struct Corrente {
    device: Device,
    params: Arc<DeviceParams>,
    /// For each of the binding's values, where its param is in `params` (None for one nothing sets).
    value_params: Vec<Option<usize>>,
    engine: Engine,
    /// The block rendered last, left and right, played out sample by sample.
    output: [[f32; BLOCK]; 2],
    /// How far into the block the host has reached: where the next sample plays from `output`, and
    /// where notes arriving now start in the next block.
    position: usize,
    /// Notes for the next block, at their place in it.
    events: Vec<(usize, Event)>,
    /// What each value was last set to, so only changes are sent.
    sent: Vec<f64>,
}

impl Default for Corrente {
    fn default() -> Self {
        let device = device::built_in();
        let params = Arc::new(DeviceParams::new(&device.params));
        let value_params = device.values.iter().map(|id| id.as_deref().and_then(|id| params.index_of(id))).collect();
        Self {
            device,
            params,
            value_params,
            engine: Engine::new(),
            output: [[0.0; BLOCK]; 2],
            position: 0,
            events: Vec::with_capacity(MAX_EVENTS),
            sent: Vec::new(),
        }
    }
}

impl Corrente {
    /// Make the engine at `rate` and load the device's plan into it, its params at their values now.
    fn load(&mut self, rate: f32) -> bool {
        self.engine.init(rate as i32, 1);
        let Ok(plan) = corrente_engine::parse_plan(&self.device.words) else {
            nice_error!("{}'s plan didn't parse", self.device.label);
            return false;
        };
        if !self.engine.load(0, plan) {
            return false;
        }
        // The binding, then each value now, then where each starts: NaN, at its value.
        self.sent = (0..self.device.values.len()).map(|value| self.value_now(value)).collect();
        let starts = vec![f64::NAN; self.sent.len()];
        let words: Vec<f64> = [&self.device.binding[..], &self.sent, &starts].concat();
        self.engine.bind(0, &words)
    }

    /// A value's raw value now, read from its param.
    fn value_now(&self, value: usize) -> f64 {
        self.value_params[value].map_or(0.0, |index| f64::from(self.params.params[index].1.engine_value()))
    }

    /// Render the next block: send changed params, start and stop the notes gathered for it, tell
    /// the engine where the transport is, then keep its output to play out.
    fn render(&mut self, beat: f64, tempo: f32, playing: bool) {
        for value in 0..self.sent.len() {
            let now = self.value_now(value);
            if now != self.sent[value] {
                self.sent[value] = now;
                if let Some(track) = self.engine.track_mut(0) {
                    track.set_value(value, now);
                }
            }
        }
        for index in 0..self.events.len() {
            let (offset, event) = self.events[index];
            match event {
                Event::On { note, velocity } => self.engine.key_on(0, offset as i32, i32::from(note), f64::from(velocity)),
                Event::Off { note } => {
                    if let Some(track) = self.engine.track_mut(0) {
                        track.key_off(offset as i32, i32::from(note));
                    }
                }
            }
        }
        self.events.clear();
        self.engine.set_transport(beat, tempo, playing);
        self.engine.process();
        if let Some(track) = self.engine.track_mut(0) {
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

    // Off the audio thread: making the engine and loading the plan allocate.
    fn activate(&mut self, _layout: &AudioIOLayout, buffer: &BufferConfig, context: &mut impl ActivateContext<Self>) -> bool {
        context.set_latency_samples(BLOCK as u32);
        self.load(buffer.sample_rate)
    }


    // May be called on the audio thread: lets go of every key, cuts every voice and starts the block
    // over, allocating nothing.
    fn reset(&mut self) {
        if let Some(track) = self.engine.track_mut(0) {
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
