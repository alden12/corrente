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
    *fresh.params.package.lock().expect("the package") = package::Package::parse(BUILT_IN).expect("the built-in");
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

/// `json` with value `index`'s engine value (or title) changed, as the window would send it.
// TS: const package = JSON.parse(json); package.values[index][field] = to; return JSON.stringify(package);
fn changed(json: &str, index: usize, field: &str, to: serde_json::Value) -> String {
    let mut package: serde_json::Value = serde_json::from_str(json).expect("a package");
    package["values"][index][field] = to;
    package.to_string()
}

/// The window sends the whole package on every change: one with only values moved sets those between
/// blocks, with no rebuild, and the moved values are saved. The built-in's first param is macro 1's,
/// so this is the macro path; the drum kit (with `CORRENTE_PACKAGES`) has values past the macros, so
/// it checks a fixed one too.
#[test]
fn a_moved_value_sets_without_a_rebuild_and_is_saved() {
    // TS: const packages = [BUILT_IN, ...(process.env.CORRENTE_PACKAGES ? [read("drumkit.json")] : [])];
    let drums = std::env::var_os("CORRENTE_PACKAGES").map(|packages| std::fs::read_to_string(PathBuf::from(packages).join("drumkit.json")).expect("export.ts's drumkit"));
    for json in std::iter::once(BUILT_IN.to_owned()).chain(drums) {
        // TS: the first param, and the last if it's past the macros.
        let mut plugin = active(&json);
        let package = package::Package::parse(&json).expect("a package");
        let params: Vec<usize> = package.values.iter().enumerate().filter(|(_, value)| matches!(value, package::Value::Param { .. })).map(|(index, _)| index).collect();
        let moving: Vec<(usize, f64)> = std::iter::once((params[0], 0.25)).chain((params.len() > params::MACROS).then(|| (params[params.len() - 1], 0.75))).collect();
        // TS: send the package changed, value by value: each load reports just its moved value, and builds nothing.
        for &(index, raw) in &moving {
            let saved = plugin.params.package.lock().ok().and_then(|package| serde_json::to_string(&*package).ok()).expect("saved");
            assert_eq!(plugin.params.load(&changed(&saved, index, "raw", raw.into())), Some(vec![(index, raw)]), "just the value that moved");
            assert!(plugin.params.incoming.lock().expect("incoming").is_none(), "no device rebuilt");
        }
        // TS: one block later the engine has them; and saving keeps them, as the same device.
        play(&mut plugin, &[], 1);
        let saved = package::Package::parse(&plugin.params.serialize_fields()["package"]).expect("the saved package reads");
        let device = plugin.device.as_deref().expect("playing");
        for &(index, raw) in &moving {
            assert_eq!(device.sent[index], raw, "{} plays it", package.label);
            assert_eq!(saved.values[index].raw(), Some(raw), "{} saves it", package.label);
        }
        assert!(saved.same_device(&package));
    }
}

/// Anything more than values (here a param's title) is another device: built off the audio thread, and
/// swapped in at the next block. Each value a macro is mapped to comes back, for the window to move
/// the host's knob to (they sit where the old device's values were).
#[test]
fn another_device_from_the_window_swaps_in() {
    let mut plugin = active(BUILT_IN);
    let package = package::Package::parse(BUILT_IN).expect("the built-in");
    let index = package.values.iter().position(|value| matches!(value, package::Value::Param { .. })).expect("a param");
    // TS: expect(load(renamed)).toEqual(the first MACROS params' [value, raw]);
    let mapped: Vec<(usize, f64)> = package.values.iter().enumerate().filter(|(_, value)| matches!(value, package::Value::Param { .. })).map(|(at, value)| (at, value.raw().expect("a param's"))).take(params::MACROS).collect();
    assert_eq!(plugin.params.load(&changed(BUILT_IN, index, "title", "Renamed".into())), Some(mapped));
    assert!(plugin.params.incoming.lock().expect("incoming").is_some(), "a device waits to swap in");
    play(&mut plugin, &[], 1);
    assert!(plugin.params.incoming.lock().expect("incoming").is_none(), "and has");
    assert_eq!(plugin.params.targets.read().expect("targets")[0].as_ref().expect("a target").title, "Renamed");
}

/// The window maps the macros by the params' binding names (PLUGIN-3.4): the device is built again to
/// play the mapped param through its macro, and the mapping is saved and restored with the package.
#[test]
fn macros_map_by_name_and_are_saved() {
    // TS: const level = the built-in's "Amp Level"; plugin.params.setMacros(["instrument.amp.level", null, ...]);
    let package = package::Package::parse(BUILT_IN).expect("the built-in");
    let level = package.values.iter().position(|value| matches!(value, package::Value::Param { title, .. } if title == "Amp Level")).expect("a level");
    let mut slots: params::Slots = vec![None; params::MACROS];
    slots[0] = Some("instrument.amp.level".to_owned());
    let mut plugin = active(BUILT_IN);
    assert_eq!(plugin.params.set_macros(slots.clone()), vec![(level, 0.8)], "the mapped value, for the window to move its macro to");
    play(&mut plugin, &[], 1);
    let device = plugin.device.as_deref().expect("playing");
    assert!(matches!(device.sources[level], device::Source::Macro { knob: 0, .. }), "the level plays through macro 1");
    assert_eq!(device.sources.iter().filter(|source| matches!(source, device::Source::Macro { .. })).count(), 1, "and nothing else does");
    // TS: a fresh plugin given the saved fields maps the same.
    let saved = plugin.params.serialize_fields();
    let fresh = Corrente::default();
    fresh.params.deserialize_fields(&saved);
    let targets = fresh.params.targets.read().expect("targets");
    assert_eq!(targets[0].as_ref().map(|target| target.value), Some(level));
    assert!(targets[1..].iter().all(Option::is_none));
}

/// The samples a package holds go back to the window by its ref when it opens (PLUGIN-3.6), so a
/// sample of your own plays wherever the host's project does: the ref is saved with the package.
#[test]
fn saved_samples_go_back_to_the_window_by_ref() {
    // TS: a package with a sample of the window's own (its file) and a wavetable's table, saved and read back.
    let mut package: serde_json::Value = serde_json::from_str(BUILT_IN).expect("a package");
    let values = package["values"].as_array_mut().expect("values");
    values.push(serde_json::json!({ "kind": "sample", "name": "zz.sample", "ref": "asset:mine", "file": "AAEC" }));
    values.push(serde_json::json!({ "kind": "sample", "name": "zz.table", "ref": "asset:wave", "table": "AACAPw==" }));
    values.push(serde_json::json!({ "kind": "sample", "name": "zz.none", "ref": "" }));
    let params = params::Macros::new(package::Package::parse(&package.to_string()).expect("it reads"));
    let saved = package::Package::parse(&params.serialize_fields()["package"]).expect("the saved package reads");
    let restored = params::Macros::new(saved);
    let samples: serde_json::Value = serde_json::from_str(&restored.samples_json()).expect("JSON");
    assert_eq!(samples, serde_json::json!({ "files": { "asset:mine": "AAEC" }, "tables": { "asset:wave": "AACAPw==" } }));
}

/// A sound Explore tries plays in place of the package, with its own values (no macros), and isn't
/// saved; a value moved meanwhile is saved but waits, and the package plays again when the trying
/// ends. Here the sound tried is the built-in turned all the way down, so silence says which plays.
#[test]
fn a_sound_tried_plays_instead_and_is_not_saved() {
    // TS: const level = the index of the built-in's "Amp Level"; const silent = changed(BUILT_IN, level, "raw", 0);
    let package = package::Package::parse(BUILT_IN).expect("the built-in");
    let level = package.values.iter().position(|value| matches!(value, package::Value::Param { title, .. } if title == "Amp Level")).expect("a level");
    let silent = changed(BUILT_IN, level, "raw", 0.0.into());
    let note = [(0, BLOCK * 40, 60, 0.8)];
    let mut plugin = active(BUILT_IN);
    // TS: plugin.params.preview(silent); the next blocks are silent, and no source is a macro.
    assert!(plugin.params.preview(Some(&silent)));
    assert!(peak(&play(&mut plugin, &note, 30)) < 1e-6, "the sound tried plays");
    assert!(plugin.device.as_deref().expect("playing").sources.iter().all(|source| matches!(source, device::Source::Fixed(_))), "with no macros");
    // TS: a value moved meanwhile waits, and is saved; the package saved is still the built-in's device.
    plugin.params.set_value(level, 0.5);
    play(&mut plugin, &[], 1);
    assert_eq!(plugin.device.as_deref().expect("playing").sent[level], 0.0, "the moved value waits");
    let saved = package::Package::parse(&plugin.params.serialize_fields()["package"]).expect("saved");
    assert!(saved.same_device(&package), "nothing tried is saved");
    assert_eq!(saved.values[level].raw(), Some(0.5), "the moved value is");
    // TS: plugin.params.preview(null); the package plays again.
    assert!(plugin.params.preview(None));
    assert!(peak(&play(&mut plugin, &note, 30)) > 0.05, "the package plays again");
    assert!(plugin.params.preview(None), "ending twice is fine");
}

/// What the scheme serves at `path`: its status and body.
// TS: const response = serve(new Request(`corrente://localhost${path}`)); return [response.status, response.body];
fn fetch(path: &str) -> (u16, Vec<u8>) {
    let request = wry::http::Request::builder().uri(format!("corrente://localhost{path}")).body(Vec::new()).unwrap();
    let response = editor::serve(request, &updates::Source::BuiltIn);
    (response.status().as_u16(), response.body().to_vec())
}

#[test]
fn the_page_and_what_it_links_are_built_in() {
    // TS: if (app.FILES.length === 0) return; // built without the app
    if editor::app::FILES.is_empty() {
        return eprintln!("skipped: the plugin was built without the app (run `yarn build` first)");
    }
    let (status, page) = fetch("/plugin.html");
    assert_eq!(status, 200, "the page is built in");
    // TS: const links = page.split('"/').slice(1).map((part) => "/" + part.split('"')[0]);
    let page = String::from_utf8(page).unwrap();
    let links: Vec<String> = page.split("=\"/").skip(1).map(|part| format!("/{}", part.split('"').next().unwrap())).collect();
    assert!(links.iter().any(|link| link.ends_with(".js")), "the page links its script: {links:?}");
    links.iter().for_each(|link| assert_eq!(fetch(link).0, 200, "{link} is built in"));
    assert_eq!(fetch("/nothing-here.js").0, 404);
    // TS: expect(updates.ownBuild(app.FILES)).toBeDefined();
    assert!(updates::own_build(editor::app::FILES).is_some(), "its manifest is built in, to compare newer builds with");
}

#[test]
fn each_engine_block_gets_the_beat_at_its_own_start_wrapped_by_the_host_loop() {
    // 120 beats a minute at 48 kHz. A 512-sample buffer at beat 10 renders four blocks, at indices
    // 127, 255, 383 and 511: each starts where its first event was gathered, not at the buffer.
    let per_sample = 2.0 / 48000.0;
    let starts: Vec<f64> = [127, 255, 383, 511].iter().map(|&index| block_beat(10.0, index, per_sample, None)).collect();
    let expected: Vec<f64> = [0.0, 128.0, 256.0, 384.0].iter().map(|samples| 10.0 + samples * per_sample).collect();
    assert_eq!(starts, expected);
    // A block that began in the buffer before, ending a loop from beat 8 to 12 as this buffer starts it again.
    let wrapped = block_beat(8.0, 63, per_sample, Some((8.0, 12.0)));
    assert!((wrapped - (12.0 - 64.0 * per_sample)).abs() < 1e-12, "{wrapped}");
    // Outside the loop, nothing wraps.
    assert_eq!(block_beat(20.0, 127, per_sample, Some((8.0, 12.0))), 20.0);
}

#[test]
fn the_windows_keys_play() {
    // TS:
    //   const plugin = active(BUILT_IN); plugin.params.play(60, 0.9); plugin.takePlayed();
    //   expect(peak(play(plugin, [], 20))).toBeGreaterThan(0.01);
    let mut plugin = active(BUILT_IN);
    plugin.params.play(60, 0.9);
    plugin.take_played();
    assert!(peak(&play(&mut plugin, &[], 20)) > 0.01, "the key sounds");
}

/// A site serving one build: its manifest (built at `built`, against engine `engine`) and its files.
// TS: const site = (built, engine, files) => { const manifest = { id, built, engine, protocol: 1, files: files.map(...) }; return { [MANIFEST]: JSON.stringify(manifest), ...files }; };
fn site(id: &str, built: u64, engine: &str, files: &[(&str, &str)]) -> BTreeMap<String, Vec<u8>> {
    use sha2::{Digest, Sha256};
    let listed: Vec<serde_json::Value> = files
        .iter()
        .map(|(path, text)| serde_json::json!({ "path": path, "sha256": Sha256::digest(text.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect::<String>() }))
        .collect();
    let manifest = serde_json::json!({ "id": id, "built": built, "engine": engine, "protocol": 1, "files": listed });
    let mut served: BTreeMap<String, Vec<u8>> = files.iter().map(|(path, text)| (path.to_string(), text.as_bytes().to_vec())).collect();
    served.insert(updates::MANIFEST.to_owned(), manifest.to_string().into_bytes());
    served
}

/// An empty folder of its own, for one test.
// TS: return mkdtempSync(join(tmpdir(), `corrente-${name}-`));
fn empty_folder(name: &str) -> PathBuf {
    let folder = std::env::temp_dir().join(format!("corrente-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

/// The plugin's own build, as `site` would describe it.
fn own(built: u64) -> updates::Build {
    updates::Build::parse(&site("own", built, "engine-1", &[])[updates::MANIFEST]).unwrap()
}

#[test]
fn a_newer_page_that_fits_is_downloaded_whole_and_served() {
    let folder = empty_folder("newer");
    let served = site("b2", 200, "engine-1", &[("plugin.html", "<p>new</p>"), ("assets/app.js", "go()")]);
    // TS: const build = download(folder, own(100), (path) => served[path]);
    let build = updates::download(&folder, &own(100), |path| served.get(path).cloned()).expect("taken");
    assert_eq!(build.id, "b2");
    let source = updates::newest(&folder, &own(100));
    assert_eq!(source.id(), Some("b2"), "the page comes from it now");
    assert_eq!(source.read("assets/app.js", &[]).as_deref(), Some(&b"go()"[..]));
    assert_eq!(source.read(updates::MANIFEST, &[]), None, "only what the manifest lists is served");
    // TS: expect(download(folder, own(100), fetch)).toBeUndefined(); // nothing newer
    assert_eq!(updates::download(&folder, &own(100), |path| served.get(path).cloned()), None, "it's there already");
    // A plugin whose own build is newer keeps its own.
    assert_eq!(updates::newest(&folder, &own(300)), updates::Source::BuiltIn);
    let _ = std::fs::remove_dir_all(folder);
}

#[test]
fn a_page_this_binary_cant_play_or_that_doesnt_check_out_is_never_taken() {
    let folder = empty_folder("refused");
    let take = |served: BTreeMap<String, Vec<u8>>| updates::download(&folder, &own(100), |path| served.get(path).cloned());
    assert_eq!(take(site("engine", 200, "engine-2", &[("plugin.html", "x")])), None, "another engine waits for a new binary");
    assert_eq!(take(site("older", 50, "engine-1", &[("plugin.html", "x")])), None, "older than its own");
    assert_eq!(take(site("escape", 200, "engine-1", &[("../outside.html", "x")])), None, "a path outside its folder");
    let mut tampered = site("tampered", 200, "engine-1", &[("plugin.html", "x")]);
    tampered.insert("plugin.html".to_owned(), b"not x".to_vec());
    assert_eq!(take(tampered), None, "a file that doesn't match its hash");
    let mut missing = site("missing", 200, "engine-1", &[("plugin.html", "x")]);
    missing.remove("plugin.html");
    assert_eq!(take(missing), None, "a file that didn't come");
    // TS: expect(readdirSync(folder)).toEqual([]); // nothing half-downloaded is left
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 0, "nothing is left behind");
    assert_eq!(updates::newest(&folder, &own(100)), updates::Source::BuiltIn);
    let _ = std::fs::remove_dir_all(folder);
}

#[test]
fn only_the_newest_few_downloaded_pages_are_kept() {
    let folder = empty_folder("kept");
    (1..=5).for_each(|step| {
        let served = site(&format!("b{step}"), 100 + step, "engine-1", &[("plugin.html", "x")]);
        assert!(updates::download(&folder, &own(100), |path| served.get(path).cloned()).is_some());
    });
    // TS: expect(readdirSync(folder).sort()).toEqual(["b3", "b4", "b5"]);
    let mut kept: Vec<String> = std::fs::read_dir(&folder).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
    kept.sort();
    assert_eq!(kept, ["b3", "b4", "b5"]);
    let _ = std::fs::remove_dir_all(folder);
}

#[test]
fn a_newer_release_is_news_and_needed_once_the_engine_moves_on() {
    let release = |built: u64, engine: &str| updates::Build::parse(&site("release", built, engine, &[])[updates::MANIFEST]).unwrap();
    // TS: expect(releaseNews(release(50, "engine-1"), own(100))).toBeUndefined();
    assert_eq!(updates::release_news(&release(50, "engine-1"), &own(100)), None, "an older release isn't news");
    assert_eq!(updates::release_news(&release(100, "engine-1"), &own(100)), None, "nor the one installed");
    assert_eq!(updates::release_news(&release(200, "engine-1"), &own(100)), Some(updates::ReleaseNews { needed: false }), "a newer one is");
    assert_eq!(updates::release_news(&release(200, "engine-2"), &own(100)), Some(updates::ReleaseNews { needed: true }), "and needed with another engine");
}
