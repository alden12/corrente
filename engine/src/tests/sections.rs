//! The shared section, stereo and multi-output blocks, the post section, audio inputs, and banks.

use super::*;

#[test]
fn the_shared_section_runs_once_a_block_for_every_voice() {
    // A counter in the pre section, y[n] = 1 + y[n - 1], read by two voices through their gates.
    // Run once a block it counts 1, 2, 3 ... and each voice hears the same count, so the track plays
    // twice the count. Run once per voice, it would count twice as fast.
    let plan = PlanBuilder::new()
        .node_in(PRE, kind("add"), vec![constant(1.0), previous(0)], vec![])
        .step_in(PRE, SAMPLE_LOOP, vec![0])
        .node(kind("mul"), vec![shared(0), voice(SIGNAL_GATE)], vec![])
        .step(NODE, vec![0])
        .out(buffer(0));
    let mut engine = plan.playing(0);
    engine.note_on(0, 1, 0, 220.0, 1.0, 69.0);
    let output = render(&mut engine, 2);
    assert_eq!(&output[..3], &[2.0, 4.0, 6.0]);
    assert_eq!(output[BLOCK], 2.0 * (BLOCK + 1) as f32);
}

#[test]
fn a_block_with_two_outputs_plays_in_stereo() {
    // Pan hard left: the left channel is the gate, the right is silent.
    let plan = PlanBuilder::new()
        .node(kind("pan"), vec![voice(SIGNAL_GATE)], vec![constant(0.0)])
        .step(NODE, vec![0])
        .voice_out(vec![port(0, 0), port(0, 1)]);
    let mut engine = plan.playing(0);
    engine.process();
    let (left, right) = (engine.output(0, 0).unwrap(), engine.output(0, 1).unwrap());
    assert!(left.iter().all(|&sample| (sample - 1.0).abs() < 1e-6));
    assert!(right.iter().all(|&sample| sample.abs() < 1e-6));
}

#[test]
fn the_post_section_runs_on_the_voices_summed() {
    // An effect after the voices: halve the sum. Two voices of gate 1 make 2, halved to 1.
    let plan = PlanBuilder::new()
        .node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![])
        .step(NODE, vec![0])
        .out(buffer(0))
        .node_in(POST, kind("mul"), vec![voice_sum(0), constant(0.5)], vec![])
        .step_in(POST, NODE, vec![0])
        .track_out(vec![buffer(0)]);
    let mut engine = plan.playing(0);
    engine.note_on(0, 1, 0, 220.0, 1.0, 69.0);
    assert!(render(&mut engine, 1).iter().all(|&sample| sample == 1.0));
}

#[test]
fn a_track_with_no_voices_processes_its_input() {
    // A return track: no voices, a post section doubling the main input's left channel.
    let plan = PlanBuilder::new()
        .voices(0)
        .node_in(POST, kind("mul"), vec![input(0), constant(2.0)], vec![])
        .step_in(POST, NODE, vec![0])
        .track_out(vec![buffer(0)]);
    let mut engine = plan.loaded();
    // TS: engine.inputMut(0, 0).forEach((_, i, input) => (input[i] = i / BLOCK))
    engine.input_mut(0, 0).unwrap().iter_mut().enumerate().for_each(|(index, sample)| *sample = index as f32 / BLOCK as f32);
    let output = render(&mut engine, 1);
    output.iter().enumerate().for_each(|(index, &sample)| assert_eq!(sample, 2.0 * index as f32 / BLOCK as f32));
}

#[test]
fn tracks_in_a_bank_play_independently() {
    // Two tracks with different plans: a note on one sounds only there.
    let gate = PlanBuilder::new().node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let half = PlanBuilder::new().node(kind("mul"), vec![voice(SIGNAL_GATE), constant(0.5)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let mut engine = Engine::new();
    engine.init(RATE, 2);
    assert!(engine.load(0, gate.plan()));
    assert!(engine.load(1, half.plan()));
    engine.note_on(1, 0, 0, 440.0, 1.0, 69.0);
    engine.process();
    assert!(engine.output(0, 0).unwrap().iter().all(|&sample| sample == 0.0));
    assert!(engine.output(1, 0).unwrap().iter().all(|&sample| sample == 0.5));
    // A track that doesn't exist takes no plan.
    assert!(!engine.load(2, gate.plan()));
}
