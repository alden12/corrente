//! PLUGIN-2.1: replay what engine.wasm was asked to do (record.ts's log) on the engine built
//! natively, and compare the two outputs sample by sample.
//!
//!   cargo run --release -- <device>.log <device>.f32
//!
//! The engine is linked as a library and driven through its C-style exports (`eng_*`), exactly as
//! the browser drives the wasm one, so this is also the smallest native host.
//!
//! Rust notes, for reading this file:
//! - `unsafe extern "C" { ... }` declares functions that live in another library (the engine).
//!   Calling one is `unsafe`: Rust can't check what's on the other side of the boundary.
//! - `match` picks a branch by value, like a `switch` that must cover every case (`_` is default).
//! - `Vec<T>` is a growable array, like a TS array.

use std::fs;

unsafe extern "C" {
    fn _initialize();
    fn eng_malloc(bytes: i32) -> *mut i32;
    fn eng_free(pointer: *mut i32);
    fn eng_init(rate: i32, tracks: i32) -> i32;
    fn eng_load(track: i32, pointer: *const i32, length: i32) -> i32;
    fn eng_carry(track: i32, pointer: *const i32, length: i32) -> i32;
    fn eng_set_param(track: i32, source: i32, value: f32);
    fn eng_param_ramp(track: i32, source: i32, samples: i32);
    fn eng_init_param(track: i32, source: i32, value: f32);
    fn eng_note_on(track: i32, slot: i32, offset: i32, frequency: f32, velocity: f32, note: f32);
    fn eng_voice_signal(track: i32, slot: i32, signal: i32, value: f32);
    fn eng_note_off(track: i32, slot: i32, offset: i32);
    fn eng_note_cut(track: i32, slot: i32, offset: i32);
    fn eng_voice_slots(track: i32) -> i32;
    fn eng_voice_active(track: i32, slot: i32) -> i32;
    fn eng_input(track: i32, channel: i32) -> *mut f32;
    fn eng_output(track: i32, channel: i32) -> *const f32;
    fn eng_transport(beat: f64, tempo: f32, playing: i32);
    fn eng_sample_reserve(slot: i32, frames: i32, channels: i32, rate: f32) -> *mut f32;
    fn eng_sample_free(slot: i32);
    fn eng_process();
    fn eng_track_peak(track: i32, channel: i32) -> f32;
    fn eng_track_silent(track: i32) -> i32;
}

const BLOCK: usize = 128;
const OUTPUT_CHANNELS: i32 = 2;

// TS: const words = (line: string[]) => line.map(Number)
// `.parse::<T>()` reads a number of type T from text; `.expect(..)` stops with that message if it isn't one.
fn ints(args: &[&str]) -> Vec<i32> {
    args.iter().map(|arg| arg.parse::<i32>().expect("an integer")).collect()
}
fn floats(args: &[&str]) -> Vec<f32> {
    // Read as a double then narrowed, as wasm narrows the doubles JS passes it.
    args.iter().map(|arg| arg.parse::<f64>().expect("a number") as f32).collect()
}

// TS: function withWords(words: number[], call: (pointer) => number): number
// `std::ptr::copy_nonoverlapping(from, to, count)` is memcpy.
fn with_words(words: &[i32], call: impl FnOnce(*const i32) -> i32) -> i32 {
    unsafe {
        let pointer = eng_malloc((words.len() * 4) as i32);
        std::ptr::copy_nonoverlapping(words.as_ptr(), pointer, words.len());
        let result = call(pointer);
        eng_free(pointer);
        result
    }
}

// TS: function write(pointer: Float32Array address, values: number[])
fn write(pointer: *mut f32, values: &[f32]) {
    assert!(!pointer.is_null(), "nowhere to write");
    unsafe { std::ptr::copy_nonoverlapping(values.as_ptr(), pointer, values.len()) }
}

/// Replays a log; returns each block's output (per track, left then right), and how many answers
/// differed from what engine.wasm answered.
fn replay(log: &str) -> (Vec<f32>, usize) {
    let mut output = Vec::new();
    let mut tracks = 0;
    let mut mismatched = 0;
    let mut sample: *mut f32 = std::ptr::null_mut();
    for line in log.lines() {
        // "name args... = result": split off what wasm answered, if anything.
        let (call, expected) = match line.split_once(" = ") {
            Some((call, result)) => (call, Some(result)),
            None => (line, None),
        };
        let parts: Vec<&str> = call.split(' ').collect();
        let (name, args) = (parts[0], &parts[1..]);
        let int = ints;
        let answer: Option<f64> = unsafe {
            match name {
                "_initialize" => {
                    _initialize();
                    None
                }
                "eng_init" => {
                    let [rate, count] = int(args)[..] else { panic!("eng_init args") };
                    tracks = count;
                    Some(eng_init(rate, count).into())
                }
                "eng_load" | "eng_carry" => {
                    let words = int(args);
                    let (track, length) = (words[0], words[1]);
                    let load = if name == "eng_load" { eng_load } else { eng_carry };
                    Some(with_words(&words[2..], |pointer| load(track, pointer, length)).into())
                }
                "eng_set_param" | "eng_init_param" => {
                    let values = floats(args);
                    let set = if name == "eng_set_param" { eng_set_param } else { eng_init_param };
                    set(values[0] as i32, values[1] as i32, values[2]);
                    None
                }
                "eng_param_ramp" => {
                    let values = int(args);
                    eng_param_ramp(values[0], values[1], values[2]);
                    None
                }
                "eng_note_on" => {
                    let values = floats(args);
                    eng_note_on(values[0] as i32, values[1] as i32, values[2] as i32, values[3], values[4], values[5]);
                    None
                }
                "eng_voice_signal" => {
                    let values = floats(args);
                    eng_voice_signal(values[0] as i32, values[1] as i32, values[2] as i32, values[3]);
                    None
                }
                "eng_note_off" | "eng_note_cut" => {
                    let values = int(args);
                    let end = if name == "eng_note_off" { eng_note_off } else { eng_note_cut };
                    end(values[0], values[1], values[2]);
                    None
                }
                "eng_voice_slots" => Some(eng_voice_slots(int(args)[0]).into()),
                "eng_voice_active" => Some(eng_voice_active(int(args)[0], int(args)[1]).into()),
                "eng_track_peak" => Some(eng_track_peak(int(args)[0], int(args)[1]).into()),
                "eng_track_silent" => Some(eng_track_silent(int(args)[0]).into()),
                "eng_transport" => {
                    let beat = args[0].parse::<f64>().expect("a beat");
                    eng_transport(beat, args[1].parse::<f64>().expect("a tempo") as f32, int(&args[2..])[0]);
                    None
                }
                "eng_sample_reserve" => {
                    let values = floats(args);
                    sample = eng_sample_reserve(values[0] as i32, values[1] as i32, values[2] as i32, values[3]);
                    None
                }
                "sample_data" => {
                    write(sample, &floats(args));
                    None
                }
                "eng_sample_free" => {
                    eng_sample_free(int(args)[0]);
                    None
                }
                "input" => {
                    let values = floats(args);
                    write(eng_input(values[0] as i32, values[1] as i32), &values[2..]);
                    None
                }
                "eng_process" => {
                    eng_process();
                    for track in 0..tracks {
                        for channel in 0..OUTPUT_CHANNELS {
                            let block = std::slice::from_raw_parts(eng_output(track, channel), BLOCK);
                            output.extend_from_slice(block);
                        }
                    }
                    None
                }
                other => panic!("the replay doesn't know {other}"),
            }
        };
        if let (Some(expected), Some(answer)) = (expected, answer) {
            if expected.parse::<f64>().expect("a result") as f32 != answer as f32 {
                mismatched += 1;
            }
        }
    }
    (output, mismatched)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, log, reference] = &args[..] else { panic!("usage: replay <device>.log <device>.f32") };
    let (output, mismatched) = replay(&fs::read_to_string(log).expect("the log"));
    // TS: new Float32Array(readFileSync(reference).buffer)
    let expected: Vec<f32> = fs::read(reference)
        .expect("the reference")
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect();
    assert_eq!(output.len(), expected.len(), "a different number of samples");
    let differing = output.iter().zip(&expected).filter(|(native, wasm)| native.to_bits() != wasm.to_bits()).count();
    let largest = output.iter().zip(&expected).map(|(native, wasm)| (native - wasm).abs()).fold(0.0f32, f32::max);
    let peak = expected.iter().map(|sample| sample.abs()).fold(0.0f32, f32::max);
    println!(
        "{} samples, {differing} not bit-identical, largest difference {largest:e} (peak {peak:.3}), {mismatched} answers differed",
        output.len()
    );
}
