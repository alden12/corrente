//! PLUGIN-2.2's spike: a plugin whose editor is a webview, to learn whether the rack UI (`src/ui`)
//! can live in a plugin window as it is, rather than being rewritten natively.
//!
//! The audio is a stand-in: one sine voice played from MIDI, at a Gain the host can automate. The
//! editor (editor.rs) is what's being tested: a page served from the plugin, a Gain slider on it
//! that sets the host parameter, the host's changes shown on the page as they happen, and the
//! window closed, reopened and resized at will.
//!
//! Rust notes, for reading this file:
//! - `#[derive(Params)]` has nih-plug write the code that lists the struct's params for the host;
//!   `#[id = "gain"]` is the param's stable id, saved in the host's project.
//! - `impl Plugin for Spike` is Spike implementing nih-plug's `Plugin` interface (a TS `implements`).
//!   `const NAME` and friends are values the interface asks for, fixed at compile time.
//! - `Arc<T>` is a reference-counted pointer: shared ownership, freed when the last owner goes,
//!   safe to hand to another thread. The audio thread and the editor share the params through one.

mod editor;

use nih_plug::prelude::*;
use std::sync::Arc;

pub struct Spike {
    params: Arc<SpikeParams>,
    sample_rate: f32,
    /// The voice: where it is in the sine's cycle (0 to 1), and the note it's playing.
    phase: f32,
    note: Option<u8>,
    frequency: f32,
    /// Fades the voice in and out, so notes don't click.
    level: Smoother<f32>,
}

#[derive(Params)]
pub struct SpikeParams {
    #[id = "gain"]
    pub gain: FloatParam,
}

// TS: new Spike()  (the starting state; `Default` is Rust's no-argument constructor)
impl Default for Spike {
    fn default() -> Self {
        Self {
            params: Arc::new(SpikeParams {
                gain: FloatParam::new("Gain", -12.0, FloatRange::Linear { min: -36.0, max: 0.0 })
                    .with_smoother(SmoothingStyle::Linear(20.0))
                    .with_step_size(0.1)
                    .with_unit(" dB"),
            }),
            sample_rate: 48000.0,
            phase: 0.0,
            note: None,
            frequency: 440.0,
            level: Smoother::new(SmoothingStyle::Linear(5.0)),
        }
    }
}

impl Plugin for Spike {
    const NAME: &'static str = "Corrente Webview Spike";
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

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
        Some(Box::new(editor::WebViewEditor::new(self.params.clone())))
    }

    fn initialize(&mut self, _layout: &AudioIOLayout, buffer: &BufferConfig, _context: &mut impl InitContext<Self>) -> bool {
        self.sample_rate = buffer.sample_rate;
        true
    }

    fn reset(&mut self) {
        self.phase = 0.0;
        self.note = None;
        self.level.reset(0.0);
    }

    // The audio thread: nothing here allocates (the assert_process_allocs feature checks).
    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, context: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let mut next_event = context.next_event();
        for (index, samples) in buffer.iter_samples().enumerate() {
            // `while let Some(x) = ...` loops while there's a value: the events due by this sample.
            while let Some(event) = next_event.filter(|event| event.timing() <= index as u32) {
                match event {
                    NoteEvent::NoteOn { note, velocity, .. } => {
                        self.note = Some(note);
                        self.frequency = util::midi_note_to_freq(note);
                        self.level.set_target(self.sample_rate, velocity);
                    }
                    NoteEvent::NoteOff { note, .. } if self.note == Some(note) => {
                        self.level.set_target(self.sample_rate, 0.0);
                    }
                    _ => {}
                }
                next_event = context.next_event();
            }
            let sine = (self.phase * std::f32::consts::TAU).sin();
            self.phase = (self.phase + self.frequency / self.sample_rate).fract();
            let value = sine * self.level.next() * util::db_to_gain_fast(self.params.gain.smoothed.next());
            for sample in samples {
                *sample = value;
            }
        }
        ProcessStatus::Normal
    }
}

impl ClapPlugin for Spike {
    const CLAP_ID: &'static str = "cloud.corrente.webview-spike";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("A webview editor in a plugin window (PLUGIN-2.2)");
    const CLAP_MANUAL_URL: Option<&'static str> = None;
    const CLAP_SUPPORT_URL: Option<&'static str> = None;
    const CLAP_FEATURES: &'static [ClapFeature] = &[ClapFeature::Instrument, ClapFeature::Synthesizer];
}

impl Vst3Plugin for Spike {
    const VST3_CLASS_ID: [u8; 16] = *b"CorrenteWebSpike";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Instrument, Vst3SubCategory::Synth];
}

nih_export_clap!(Spike);
nih_export_vst3!(Spike);
