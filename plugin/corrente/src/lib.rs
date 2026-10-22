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
//! - **Voices** are picked as the app picks them (voices.rs).
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
mod voices;

use corrente_engine::{BLOCK, Engine};
use device::Device;
use nice_plug::prelude::*;
use params::DeviceParams;
use std::sync::Arc;
use voices::VoiceAllocator;

/// The most note events gathered for one engine block; more are dropped.
const MAX_EVENTS: usize = 512;

/// A key's frequency as the app works it out (bank.ts's `frequencyOf`): in doubles, then narrowed.
/// nice-plug's own does it in single precision, which is a hair off and drifts the oscillators' phase.
fn frequency_of(note: u8) -> f32 {
    (440.0 * 2f64.powf((f64::from(note) - 69.0) / 12.0)) as f32
}

#[derive(Clone, Copy)]
enum Event {
    On { note: u8, velocity: f32 },
    Off { note: u8 },
}

pub struct Corrente {
    device: Device,
    params: Arc<DeviceParams>,
    /// For each engine param source, where its param is in `params` (None for one nothing sets).
    source_params: Vec<Option<usize>>,
    engine: Engine,
    voices: VoiceAllocator,
    /// The block rendered last, left and right, played out sample by sample.
    output: [[f32; BLOCK]; 2],
    /// How far into the block the host has reached: where the next sample plays from `output`, and
    /// where notes arriving now start in the next block.
    position: usize,
    /// Notes for the next block, at their place in it.
    events: Vec<(usize, Event)>,
    /// What each source was last set to, so only changes are sent.
    sent: Vec<f32>,
    /// Samples since the start, to tell the voice allocator which note came first.
    clock: u64,
}

impl Default for Corrente {
    fn default() -> Self {
        let device = device::built_in();
        let params = Arc::new(DeviceParams::new(&device.params));
        let source_params = device.sources.iter().map(|source| source.param.as_deref().and_then(|id| params.index_of(id))).collect();
        Self {
            device,
            params,
            source_params,
            engine: Engine::new(),
            voices: VoiceAllocator::new(0, 0),
            output: [[0.0; BLOCK]; 2],
            position: 0,
            events: Vec::with_capacity(MAX_EVENTS),
            sent: Vec::new(),
            clock: 0,
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
        self.sent = (0..self.device.sources.len()).map(|source| self.source_value(source)).collect();
        let Some(track) = self.engine.track_mut(0) else { return false };
        for (index, source) in self.device.sources.iter().enumerate() {
            if let Some(smooth_ms) = source.smooth_ms {
                track.set_ramp(index, (smooth_ms * rate / 1000.0).round() as usize);
            }
            track.init_param(index, self.sent[index]);
        }
        self.voices = VoiceAllocator::new(track.voice_slots(), self.device.voices);
        true
    }

    /// Each source's engine value now, read from its param.
    fn source_value(&self, source: usize) -> f32 {
        let raw = self.source_params[source].map_or(0.0, |index| self.params.params[index].1.engine_value());
        self.device.sources[source].resolve(raw)
    }

    /// Render the next block: send changed params, start and stop the notes gathered for it, tell
    /// the engine where the transport is, then keep its output to play out.
    fn render(&mut self, beat: f64, tempo: f32, playing: bool) {
        for source in 0..self.sent.len() {
            let value = self.source_value(source);
            if value != self.sent[source] {
                self.sent[source] = value;
                if let Some(track) = self.engine.track_mut(0) {
                    track.set_param(source, value);
                }
            }
        }
        for index in 0..self.events.len() {
            let (offset, event) = self.events[index];
            let Some(track) = self.engine.track_mut(0) else { break };
            match event {
                Event::On { note, velocity } => {
                    let slot = self.voices.note_on(note, self.clock + offset as u64, |slot| track.voice_active(slot));
                    if let Some(cut) = self.voices.cut {
                        track.cut(cut, offset as i32);
                    }
                    track.note_on(slot, offset as i32, frequency_of(note), velocity, f32::from(note));
                }
                Event::Off { note } => {
                    if let Some(slot) = self.voices.note_off(note, self.clock + offset as u64) {
                        track.note_off(slot, offset as i32);
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
        self.clock += BLOCK as u64;
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


    // May be called on the audio thread: cuts every voice and starts the block over, allocating nothing.
    fn reset(&mut self) {
        if let Some(track) = self.engine.track_mut(0) {
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
