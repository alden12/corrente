//! The plugin's own path, params, voices and engine, played without a host: notes go in as a host's
//! would arrive, block by block, and what comes out is checked.

use super::*;

const RATE: f32 = 48000.0;

/// A note: its start and length in samples, its key and velocity.
type Note = (usize, usize, u8, f32);

/// Play `notes` for `blocks` blocks; each block's output, left then right.
fn play(notes: &[Note], blocks: usize) -> Vec<f32> {
    let mut plugin = Corrente::default();
    assert!(plugin.load(RATE));
    let mut output = Vec::with_capacity(blocks * 2 * BLOCK);
    for block in 0..blocks {
        let range = block * BLOCK..(block + 1) * BLOCK;
        for &(start, length, note, velocity) in notes {
            if range.contains(&start) {
                plugin.events.push((start - range.start, Event::On { note, velocity }));
            }
            if range.contains(&(start + length)) {
                plugin.events.push((start + length - range.start, Event::Off { note }));
            }
        }
        plugin.render(0.0, 120.0, false);
        plugin.output.iter().for_each(|channel| output.extend_from_slice(channel));
    }
    output
}

/// record.ts's notes (engine/replay): a low note and a chord over it, overlapping, at different
/// velocities, one let go early. Seconds there, samples here.
fn record_notes() -> Vec<Note> {
    let at = |seconds: f32| (seconds * RATE) as usize;
    vec![(0, at(0.5), 36, 1.0), (at(0.25), at(1.0), 60, 0.8), (at(0.5), at(0.75), 64, 0.6), (at(0.5), at(0.3), 67, 0.9)]
}

#[test]
fn plays_notes_and_falls_quiet() {
    let output = play(&record_notes(), 750);
    assert!(output.iter().all(|sample| sample.is_finite()));
    let peak = |samples: &[f32]| samples.iter().fold(0.0f32, |most, sample| most.max(sample.abs()));
    assert!(peak(&output) > 0.1, "the notes sound");
    assert!(peak(&output[output.len() - 2 * BLOCK..]) < 1e-4, "and stop once let go");
}

/// With CORRENTE_REFERENCE naming record.ts's `subtractive.f32` (the app's renderDevice, on
/// engine.wasm), the plugin plays the same notes the same, sample for sample.
#[test]
fn sounds_as_the_app_does() {
    let Some(reference) = std::env::var_os("CORRENTE_REFERENCE") else { return };
    let expected: Vec<f32> = std::fs::read(reference)
        .expect("the reference")
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect();
    let output = play(&record_notes(), expected.len() / (2 * BLOCK));
    let largest = output.iter().zip(&expected).map(|(plugin, app)| (plugin - app).abs()).fold(0.0f32, f32::max);
    let differing = output.iter().zip(&expected).filter(|(plugin, app)| plugin.to_bits() != app.to_bits()).count();
    println!("{} samples, {differing} not bit-identical, largest difference {largest:e}", output.len());
    assert!(largest < 1e-6);
}
