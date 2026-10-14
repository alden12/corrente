//! The sample player: reading a sample the bank holds, pitched by the note, from the gate's rise to
//! its end or round its loop.

use super::*;

/// A voice playing a sampler: the note's frequency and gate in, both outputs out. `controls` are
/// sample slot, root note, start, end, loop.
// TS: const sampler = (controls: number[]) => new PlanBuilder().node(KIND_SAMPLER, [voice(FREQ), voice(GATE)], controls.map(constant)).step(NODE, [0]).voiceOut([port(0, 0), port(0, 1)])
fn sampler(controls: [f32; 5]) -> PlanBuilder {
    let controls = controls.iter().map(|&value| constant(value)).collect();
    PlanBuilder::new().node(KIND_SAMPLER, vec![voice(SIGNAL_FREQ), voice(SIGNAL_GATE)], controls).step(NODE, vec![0]).voice_out(vec![port(0, 0), port(0, 1)])
}

/// Slot 0 at the root note (A4, which `playing` plays), the whole sample, no loop.
const WHOLE: [f32; 5] = [0.0, 69.0, 0.0, 1.0, 0.0];

/// Put a mono sample in slot 0: `frames` of a ramp from 0 up by 0.001 a frame.
// TS: engine.reserveSample(0, frames, 1, rate)!.forEach((_, frame, data) => (data[frame] = frame * 0.001))
fn ramp(engine: &mut Engine, frames: usize, rate: f32) {
    let data = engine.reserve_sample(0, frames, 1, rate).expect("room for the sample");
    data.iter_mut().enumerate().for_each(|(frame, value)| *value = frame as f32 * 0.001);
}

/// Whether two samples are the same, give or take float rounding.
fn near(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-5
}

#[test]
fn plays_a_sample_at_its_root_note_frame_by_frame() {
    let mut engine = sampler(WHOLE).playing(0);
    ramp(&mut engine, 1000, RATE as f32);
    let out = render(&mut engine, 2);
    assert!(out.iter().enumerate().all(|(index, &sample)| near(sample, index as f32 * 0.001)));
}

#[test]
fn an_octave_up_reads_twice_as_fast_and_ends_twice_as_soon() {
    let mut engine = sampler(WHOLE).loaded();
    ramp(&mut engine, 200, RATE as f32);
    engine.note_on(0, 0, 0, 880.0, 1.0, 81.0);
    let out = render(&mut engine, 2);
    assert!(out[..100].iter().enumerate().all(|(index, &sample)| near(sample, index as f32 * 0.002)));
    assert!(out[100..].iter().all(|&sample| sample == 0.0), "silent past the end");
}

#[test]
fn reads_between_frames_on_a_curve_through_them() {
    // An octave down reads half a frame a sample. On a straight ramp the curve is the ramp itself,
    // away from the first frame (where the frame before is taken as the first).
    let mut engine = sampler(WHOLE).loaded();
    ramp(&mut engine, 1000, RATE as f32);
    engine.note_on(0, 0, 0, 220.0, 1.0, 57.0);
    let out = render(&mut engine, 1);
    assert!(out[4..].iter().enumerate().all(|(index, &sample)| near(sample, (index + 4) as f32 * 0.0005)));
}

#[test]
fn a_sample_at_another_rate_keeps_its_pitch() {
    // Recorded at half the engine's rate, a frame lasts two of the engine's samples.
    let mut engine = sampler(WHOLE).playing(0);
    ramp(&mut engine, 1000, RATE as f32 / 2.0);
    let out = render(&mut engine, 1);
    assert!(out[4..].iter().enumerate().all(|(index, &sample)| near(sample, (index + 4) as f32 * 0.0005)));
}

#[test]
fn starts_on_the_gate_and_from_its_start() {
    // From 10% in, with the note 10 samples into the block.
    let mut engine = sampler([0.0, 69.0, 0.1, 1.0, 0.0]).playing(10);
    ramp(&mut engine, 1000, RATE as f32);
    let out = render(&mut engine, 1);
    assert!(out[..10].iter().all(|&sample| sample == 0.0));
    assert!(out[10..].iter().enumerate().all(|(index, &sample)| near(sample, (100 + index) as f32 * 0.001)));
}

#[test]
fn loops_between_start_and_end() {
    // Frames 20 to 50 of 100, round and round.
    let mut engine = sampler([0.0, 69.0, 0.2, 0.5, 1.0]).playing(0);
    ramp(&mut engine, 100, RATE as f32);
    let out = render(&mut engine, 2);
    assert!(out.iter().enumerate().all(|(index, &sample)| near(sample, (20 + index % 30) as f32 * 0.001)));
}

#[test]
fn a_stereo_sample_plays_each_channel_to_its_side() {
    let mut engine = sampler(WHOLE).playing(0);
    // TS: data.set(left, 0); data.set(right, frames)
    let data = engine.reserve_sample(0, 200, 2, RATE as f32).expect("room for the sample");
    let (left, right) = data.split_at_mut(200);
    left.fill(0.25);
    right.fill(-0.5);
    let lefts = render_channel(&mut engine, 0, 0, 1);
    assert!(lefts.iter().all(|&sample| near(sample, 0.25)));
    assert!(engine.output(0, 1).expect("track 0").iter().all(|&sample| near(sample, -0.5)));
}

#[test]
fn a_released_note_plays_on_to_the_end_then_frees_its_voice() {
    // One-shot or held is the envelope's business: the player plays to the end either way.
    let mut engine = sampler(WHOLE).playing(0);
    ramp(&mut engine, 300, RATE as f32);
    render(&mut engine, 1);
    engine.note_off(0, 0, 0);
    let out = render(&mut engine, 1);
    assert!(near(out[72], 0.2));
    assert!(engine.voice_active(0, 0), "still sounding at the end of the sample");
    render(&mut engine, 2);
    assert!(!engine.voice_active(0, 0));
}

#[test]
fn an_empty_slot_is_silent_and_freeing_one_silences_it() {
    let mut engine = sampler([3.0, 69.0, 0.0, 1.0, 0.0]).playing(0);
    assert!(render(&mut engine, 1).iter().all(|&sample| sample == 0.0), "nothing in slot 3");
    ramp(&mut engine, 1000, RATE as f32);
    engine.free_sample(0);
    assert!(render(&mut engine, 1).iter().all(|&sample| sample == 0.0));
}

#[test]
fn samples_that_cannot_fit_are_refused() {
    let mut engine = Engine::new();
    engine.init(RATE, 1);
    assert!(engine.reserve_sample(256, 100, 1, 48000.0).is_none(), "a slot past the last");
    assert!(engine.reserve_sample(0, 100, 3, 48000.0).is_none(), "three channels");
    assert!(engine.reserve_sample(0, 0, 1, 48000.0).is_none(), "no frames");
    assert!(engine.reserve_sample(0, 1 << 24, 2, 48000.0).is_none(), "too big");
    assert!(engine.reserve_sample(0, 100, 1, 0.0).is_none(), "no rate");
}

#[test]
fn a_sampler_needs_its_inputs_and_every_control() {
    let missing_control = PlanBuilder::new()
        .node(KIND_SAMPLER, vec![voice(SIGNAL_FREQ), voice(SIGNAL_GATE)], vec![constant(0.0)])
        .step(NODE, vec![0])
        .out(buffer(0));
    assert!(missing_control.refused());
    let missing_gate = PlanBuilder::new()
        .node(KIND_SAMPLER, vec![voice(SIGNAL_FREQ)], WHOLE.iter().map(|&value| constant(value)).collect())
        .step(NODE, vec![0])
        .out(buffer(0));
    assert!(missing_gate.refused());
}

#[test]
fn dragging_the_end_in_and_out_again_plays_on_from_where_it_was() {
    // `end` from param 0, the rest fixed: whole sample, no loop, then the same with a loop.
    let with_end = |looping: f32| {
        let controls = vec![constant(0.0), constant(69.0), constant(0.0), param(0), constant(looping)];
        PlanBuilder::new()
            .params(1)
            .node(KIND_SAMPLER, vec![voice(SIGNAL_FREQ), voice(SIGNAL_GATE)], controls)
            .step(NODE, vec![0])
            .voice_out(vec![port(0, 0), port(0, 1)])
    };
    for looping in [0.0, 1.0] {
        let mut engine = with_end(looping).loaded();
        engine.init_param(0, 0, 0.5);
        ramp(&mut engine, 1000, RATE as f32);
        engine.note_on(0, 0, 0, 440.0, 1.0, 69.0);
        render(&mut engine, 1);
        engine.init_param(0, 0, 0.0);
        assert!(render(&mut engine, 1).iter().all(|&sample| sample == 0.0), "silent while the end is at 0");
        engine.init_param(0, 0, 0.5);
        let out = render(&mut engine, 1);
        assert!(out.iter().enumerate().all(|(index, &sample)| near(sample, (128 + index) as f32 * 0.001)));
    }
}

#[test]
fn each_voice_plays_the_zone_it_was_given() {
    // The sampler's slot, root, start and end come from the voice's zone signals.
    let controls = vec![voice(SIGNAL_SAMPLE), voice(SIGNAL_ROOT), voice(SIGNAL_START), voice(SIGNAL_END), constant(0.0)];
    let plan = PlanBuilder::new()
        .node(KIND_SAMPLER, vec![voice(SIGNAL_FREQ), voice(SIGNAL_GATE)], controls)
        .step(NODE, vec![0])
        .voice_out(vec![port(0, 0), port(0, 1)]);
    let mut engine = plan.loaded();
    engine.reserve_sample(1, 1000, 1, RATE as f32).expect("room").fill(0.25);
    engine.reserve_sample(2, 1000, 1, RATE as f32).expect("room").fill(-0.5);
    // A kick on its own key, so it plays at its own speed: slot 1, root 36, the whole sample.
    let zone = |engine: &mut Engine, slot: usize, sample: f32, root: f32| {
        [(SIGNAL_SAMPLE, sample), (SIGNAL_ROOT, root), (SIGNAL_START, 0.0), (SIGNAL_END, 1.0)]
            .into_iter()
            .for_each(|(signal, value)| engine.set_voice_signal(0, slot, signal, value));
    };
    engine.note_on(0, 0, 0, 65.41, 1.0, 36.0);
    zone(&mut engine, 0, 1.0, 36.0);
    let first = render(&mut engine, 1);
    assert!(first.iter().all(|&sample| near(sample, 0.25)));
    // A second note, 10 samples in (between control reads), in its own zone: the two sum from it.
    engine.note_on(0, 1, 10, 73.42, 1.0, 38.0);
    zone(&mut engine, 1, 2.0, 38.0);
    let both = render(&mut engine, 1);
    assert!(both[..10].iter().all(|&sample| near(sample, 0.25)));
    assert!(both[10..].iter().all(|&sample| near(sample, -0.25)));
    // A signal that isn't a zone's, or a slot not sounding, is left alone.
    engine.set_voice_signal(0, 0, SIGNAL_GATE, 0.0);
    engine.set_voice_signal(0, 3, SIGNAL_SAMPLE, 2.0);
    assert!(render(&mut engine, 1).iter().all(|&sample| near(sample, -0.25)));
    assert!(!engine.voice_active(0, 3));
}
