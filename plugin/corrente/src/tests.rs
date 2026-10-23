//! The plugin's own path, macros, packages and engine, played without a host: notes go in as a host's
//! would arrive, block by block, and what comes out is checked.
//!
//! Two tests compare with the app, and run only when given its files:
//! - `CORRENTE_PACKAGES`: a folder of export.ts's packages (`export.ts <type>... --out <dir>`).
//! - `CORRENTE_REFERENCE`: a folder of engine/replay/record.ts's renders (`<type>.f32`), the app's
//!   renderDevice on engine.wasm playing the same notes.

use super::*;
use device::Source;
use package::ParamSpec;
use std::collections::BTreeMap;
use std::path::PathBuf;

const RATE: f32 = 48000.0;

/// A note: its start and length in samples, its key and velocity.
type Note = (usize, usize, u8, f32);

/// A plugin playing `json`'s package, active at RATE.
// TS: const plugin = Corrente.withPackage(json)!; expect(plugin.load(RATE)).toBe(true); return plugin;
fn active(json: &str) -> Corrente {
    let mut plugin = Corrente::with_package(json).expect("a package");
    assert!(plugin.load(RATE), "it loads");
    plugin
}

/// Play `notes` for `blocks` blocks; each block's output, left then right.
fn play(plugin: &mut Corrente, notes: &[Note], blocks: usize) -> Vec<f32> {
    // TS: for each block: push the notes starting or ending in it, at their offset; render; keep both channels.
    // `start..end` is a range; `.contains(&x)` asks whether x is in it.
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
    // TS: const at = (seconds: number) => Math.floor(seconds * RATE); return [[0, at(0.5), 36, 1], ...];
    let at = |seconds: f32| (seconds * RATE) as usize;
    vec![(0, at(0.5), 36, 1.0), (at(0.25), at(1.0), 60, 0.8), (at(0.5), at(0.75), 64, 0.6), (at(0.5), at(0.3), 67, 0.9)]
}

// TS: return Math.max(0, ...samples.map(Math.abs))  (`fold` is reduce, from 0)
fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |most, sample| most.max(sample.abs()))
}

#[test]
fn plays_notes_and_falls_quiet() {
    // TS: const output = play(active(BUILT_IN), recordNotes(), 750); expect every sample finite, a peak over 0.1, the last two blocks quiet.
    let output = play(&mut active(BUILT_IN), &record_notes(), 750);
    assert!(output.iter().all(|sample| sample.is_finite()));
    assert!(peak(&output) > 0.1, "the notes sound");
    assert!(peak(&output[output.len() - 2 * BLOCK..]) < 1e-4, "and stop once let go");
}

/// A macro plays the package's own value until it moves (`Source::now`), then its position through
/// the param's spec: tapers, steps, choices and switches as the app's knobs set them.
#[test]
fn macros_map_positions_as_the_apps_knobs_do() {
    // TS: the specs' maths first: an exponential knob's middle is the geometric mean, a step rounds, a choice is its index.
    let plugin = active(BUILT_IN);
    let knobs = &plugin.params.knobs;
    let cutoff = ParamSpec::Number { min: 20.0, max: 20000.0, unit: None, taper: Some("exponential".to_owned()), step: None };
    assert!((cutoff.engine_value(0.5) - (20.0f64 * 20000.0).sqrt()).abs() < 1e-9, "the middle of an exponential knob");
    assert!((cutoff.position(cutoff.engine_value(0.3)) - 0.3).abs() < 1e-12);
    let tune = ParamSpec::Number { min: -24.0, max: 24.0, unit: None, taper: None, step: Some(1.0) };
    assert_eq!(tune.engine_value(0.51), 0.0, "onto its step");
    let shape = ParamSpec::Enum { options: vec!["sine".into(), "saw".into(), "square".into()] };
    assert_eq!(shape.engine_value(0.8), 2.0);
    // TS: a macro whose knob sits where it started plays the raw value; one whose start was elsewhere plays the knob.
    let still = knobs[0].value();
    let raw = 0.123;
    let held = Source::Macro { knob: 0, spec: tune.clone(), raw, still };
    assert_eq!(held.now(knobs), raw, "the package's value, exactly, until the knob moves");
    let moved = Source::Macro { knob: 0, spec: tune.clone(), raw, still: still + 0.25 };
    assert_eq!(moved.now(knobs), tune.engine_value(f64::from(still)), "then the knob's");
}

/// Saving the state and opening it in a fresh plugin plays the same device, swapped in between
/// blocks as when a host restores a project.
#[test]
fn a_saved_device_plays_again_in_a_fresh_plugin() {
    // TS: const packages = process.env.CORRENTE_PACKAGES; if (!packages) return;
    let Some(packages) = std::env::var_os("CORRENTE_PACKAGES").map(PathBuf::from) else { return };
    // TS: const saved = active(json).params.serializeFields(); const expected = play(active(json), recordNotes(), 200);
    let json = std::fs::read_to_string(packages.join("drumkit.json")).expect("export.ts's drumkit");
    let saved: BTreeMap<String, String> = active(&json).params.serialize_fields();
    let expected = play(&mut active(&json), &record_notes(), 200);
    // A host restores the macros first, then the package: so the fresh plugin's knobs are where the
    // drum kit left them (made from it), while it plays the built-in device until the package arrives.
    let mut fresh = Corrente::with_package(&json).expect("a package");
    *fresh.params.package.lock().expect("the package") = BUILT_IN.to_owned();
    assert!(fresh.load(RATE));
    // TS: fresh.params.deserializeFields(saved); expect(play(fresh, recordNotes(), 200)).toEqual(expected);
    fresh.params.deserialize_fields(&saved);
    let restored = play(&mut fresh, &record_notes(), 200);
    assert_eq!(restored, expected);
}

/// Each exported package plays record.ts's notes as the app does, sample for sample.
#[test]
fn sounds_as_the_app_does() {
    let (Some(packages), Some(references)) = (std::env::var_os("CORRENTE_PACKAGES"), std::env::var_os("CORRENTE_REFERENCE")) else { return };
    // TS: for (const path of readdirSync(packages).sort()) { read the package and `<name>.f32`, play, compare sample by sample }
    // `f32::from_le_bytes(bytes.try_into().unwrap())` reads four little-endian bytes as a float.
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&packages).expect("the packages").map(|entry| entry.expect("an entry").path()).collect();
    entries.sort();
    for path in entries {
        let device = path.file_stem().and_then(|stem| stem.to_str()).expect("a name").to_owned();
        let json = std::fs::read_to_string(&path).expect("a package");
        let expected: Vec<f32> = std::fs::read(PathBuf::from(&references).join(format!("{device}.f32")))
            .expect("its reference")
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
            .collect();
        let output = play(&mut active(&json), &record_notes(), expected.len() / (2 * BLOCK));
        let largest = output.iter().zip(&expected).map(|(plugin, app)| (plugin - app).abs()).fold(0.0f32, f32::max);
        let differing = output.iter().zip(&expected).filter(|(plugin, app)| plugin.to_bits() != app.to_bits()).count();
        println!("{device}: {} samples, {differing} not bit-identical, largest difference {largest:e}, peak {}", output.len(), peak(&expected));
        assert!(largest < 1e-6, "{device} differs from the app");
    }
}
