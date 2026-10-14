//! Notes: starting on their sample, in both channels, and freeing their voice once released.

use super::*;

// TS: it("a note starts on its sample", () => { ... })
// `output[..37]` is output.slice(0, 37); `output[37..]` is output.slice(37).
// `|&sample| sample == 0.0`: `&sample` copies the number out of the reference the iterator gives.
#[test]
fn a_note_starts_on_its_sample() {
    // The gate itself as the output: 0 until the note, then 1.
    let plan = PlanBuilder::new().node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let mut engine = plan.playing(37);
    let output = render(&mut engine, 1);
    assert!(output[..37].iter().all(|&sample| sample == 0.0));
    assert!(output[37..].iter().all(|&sample| sample == 1.0));
}

#[test]
fn a_mono_voice_plays_in_both_channels() {
    let plan = PlanBuilder::new().node(kind("saw"), vec![voice(0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let mut engine = plan.playing(0);
    engine.process();
    assert_eq!(engine.output(0, 0), engine.output(0, 1));
}

#[test]
fn nothing_sounds_until_a_note_plays() {
    let plan = PlanBuilder::new().node(kind("saw"), vec![voice(0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let mut engine = plan.loaded();
    assert!(render(&mut engine, 2).iter().all(|&sample| sample == 0.0));
    engine.note_on(0, 0, 0, 440.0, 1.0, 69.0);
    assert!(render(&mut engine, 2).iter().any(|&sample| sample.abs() > 0.1));
}

#[test]
fn a_released_voice_frees_its_slot_once_silent() {
    // A saw shaped by an envelope with a 10 ms release.
    let plan = PlanBuilder::new()
        .node(kind("saw"), vec![voice(0)], vec![])
        .node(kind("adsr"), vec![voice(SIGNAL_GATE)], vec![constant(0.001), constant(0.001), constant(1.0), constant(0.01)])
        .node(kind("mul"), vec![buffer(0), buffer(1)], vec![])
        .step(NODE, vec![0])
        .step(NODE, vec![1])
        .step(NODE, vec![2])
        .out(buffer(2));
    let mut engine = plan.playing(0);
    render(&mut engine, 8);
    assert!(engine.voice_active(0, 0));
    engine.note_off(0, 0, 0);
    // 10 ms is 480 samples, under 4 blocks; give it 8.
    render(&mut engine, 8);
    assert!(!engine.voice_active(0, 0));
}
