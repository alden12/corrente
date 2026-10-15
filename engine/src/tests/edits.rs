//! Changes that mustn't click: a new plan crossfading in over a block, and a stolen voice fading out.

use super::*;

/// A plan whose track plays `level` and nothing else.
// TS: const steady = (level: number) => new PlanBuilder().trackOut([constant(level)])
fn steady(level: f32) -> PlanBuilder {
    PlanBuilder::new().voices(0).track_out(vec![constant(level)])
}

#[test]
fn a_new_plan_crossfades_in_over_a_block() {
    let mut engine = steady(1.0).loaded();
    assert!(render(&mut engine, 1).iter().all(|&sample| sample == 1.0));
    assert!(engine.load(0, steady(0.5).plan()));
    let fading = render(&mut engine, 1);
    // TS: fading.forEach((sample, index) => { const fadeIn = (index + 1) / BLOCK; expect(sample).toBeCloseTo(0.5 * fadeIn + (1 - fadeIn)) })
    fading.iter().enumerate().for_each(|(index, &sample)| {
        let fade_in = (index + 1) as f32 / BLOCK as f32;
        assert!((sample - (0.5 * fade_in + (1.0 - fade_in))).abs() < 1e-6);
    });
    assert!(render(&mut engine, 2).iter().all(|&sample| sample == 0.5));
}

#[test]
fn a_second_load_before_a_block_still_fades_from_what_was_playing() {
    let mut engine = steady(1.0).loaded();
    render(&mut engine, 1);
    assert!(engine.load(0, steady(0.25).plan()));
    assert!(engine.load(0, steady(0.5).plan()));
    // The 0.25 plan never played: the fade is from 1 to 0.5, as if it had never loaded.
    render(&mut engine, 1).iter().enumerate().for_each(|(index, &sample)| {
        let fade_in = (index + 1) as f32 / BLOCK as f32;
        assert!((sample - (0.5 * fade_in + (1.0 - fade_in))).abs() < 1e-6);
    });
}

#[test]
fn a_cut_voice_fades_out_over_a_block_and_frees_its_slot() {
    // The gate as the output: 1 while the note is held.
    let plan = PlanBuilder::new().node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let mut engine = plan.playing(0);
    render(&mut engine, 1);
    engine.track_mut(0).unwrap().cut(0, 32);
    let cut = render(&mut engine, 2);
    assert!(cut[..32].iter().all(|&sample| sample == 1.0));
    // TS: each sample after the cut starts is a step lower, down to 0 a block later.
    cut[32..32 + BLOCK].iter().enumerate().for_each(|(index, &sample)| {
        assert!((sample - (1.0 - (index + 1) as f32 / BLOCK as f32)).abs() < 1e-6);
    });
    assert!(cut[32 + BLOCK..].iter().all(|&sample| sample == 0.0));
    assert!(!engine.track(0).is_some_and(|track| track.voice_active(0)));
}

#[test]
fn a_plan_has_spare_voice_slots_for_notes_that_start_while_others_fade() {
    let engine = PlanBuilder::new().voices(4).node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0)).loaded();
    assert_eq!(engine.track(0).map(|track| track.voice_slots()), Some(8));
    // A plan with no voices has no notes to steal for, so no spares either.
    let effect = PlanBuilder::new().voices(0).track_out(vec![input(0)]).loaded();
    assert_eq!(effect.track(0).map(|track| track.voice_slots()), Some(0));
}

/// Carry words for `eng_carry`: whether voices carry, then the pre and post sections' maps.
// TS: const carryWords = (voices: boolean, pre: number[], post: number[]) => [voices ? 1 : 0, pre.length, ...pre, post.length, ...post]
fn carry_words(voices: bool, pre: &[i32], post: &[i32]) -> Vec<i32> {
    [vec![voices as i32, pre.len() as i32], pre.to_vec(), vec![post.len() as i32], post.to_vec()].concat()
}

/// A track whose output is its input delayed by 200 samples; `extra` puts a mul before the delay,
/// so the delay is node 1 rather than 0.
// TS: const [plan, delay] = extra ? [builder.nodeIn(POST, mul, ...).stepIn(POST, NODE, [0]), 1] : [builder, 0]; return plan.nodeIn(POST, DELAY, ...)...
// An `if` is an expression in Rust, so it can give the pair straight to `let`.
fn echo(extra: bool) -> PlanBuilder {
    let plan = PlanBuilder::new().voices(0);
    let (plan, delay) = if extra {
        (plan.node_in(POST, kind("mul"), vec![input(0), constant(1.0)], vec![]).step_in(POST, NODE, vec![0]), 1)
    } else {
        (plan, 0)
    };
    plan.node_in(POST, KIND_DELAY, vec![input(0), constant(200.0)], vec![constant(1000.0)]).step_in(POST, NODE, vec![delay]).track_out(vec![buffer(delay)])
}

/// An impulse into `echo(false)`, a block, then a reload to `echo(true)` carried by `map` (or not):
/// the 3 blocks from the start.
// TS: returns [samples, carried]. `map.and_then(f)` is `map && f(map)`, keeping None as None.
fn echo_across_a_load(map: Option<&[i32]>) -> (Vec<f32>, Option<usize>) {
    let mut engine = echo(false).loaded();
    engine.track_mut(0).and_then(|track| track.input_mut(0)).expect("track 0")[0] = 1.0;
    let mut out = render(&mut engine, 1);
    engine.track_mut(0).and_then(|track| track.input_mut(0)).expect("track 0")[0] = 0.0;
    assert!(engine.load(0, echo(true).plan()));
    let carried = map.and_then(|map| engine.track_mut(0).and_then(|track| track.carry(&carry_words(false, &[], map))));
    out.extend(render(&mut engine, 2));
    (out, carried)
}

#[test]
fn a_carried_delay_keeps_its_echo_across_a_load() {
    let (out, carried) = echo_across_a_load(Some(&[-1, 0]));
    assert_eq!(carried, Some(1));
    // The echo lands on time and whole: no crossfade, since the new plan carries on.
    assert_eq!(out.iter().position(|&sample| sample != 0.0), Some(200));
    assert_eq!(out[200], 1.0);
    // Without the carry, the new plan's delay starts empty: only the old plan, fading out over the
    // block after the load, plays any of the echo.
    let (lost, _) = echo_across_a_load(None);
    assert!(lost[200] < 0.5);
}

#[test]
fn a_carry_that_does_not_fit_changes_nothing() {
    // The delay mapped to the mul, a map one short, and an old node taken twice.
    // `&[0, -1][..]` is the array as a slice, so all three are the same type whatever their length.
    [&[0, -1][..], &[0][..], &[0, 0][..]].iter().for_each(|&map| {
        let (out, carried) = echo_across_a_load(Some(map));
        assert_eq!(carried, None);
        // Loaded as if there were no carry: the old plan fades out with the echo.
        assert!(out[200] < 0.5);
    });
    // A delay can't take over one with a different ring.
    let mut engine = echo(false).loaded();
    let resized = PlanBuilder::new().voices(0).node_in(POST, KIND_DELAY, vec![input(0), constant(200.0)], vec![constant(100_000.0)]).step_in(POST, NODE, vec![0]).track_out(vec![buffer(0)]);
    assert!(engine.load(0, resized.plan()));
    assert_eq!(engine.track_mut(0).and_then(|track| track.carry(&carry_words(false, &[], &[0]))), None);
}

#[test]
fn carried_voices_keep_playing_across_a_load() {
    // The gate as the output: 1 while the note is held.
    let plan = PlanBuilder::new().node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let mut engine = plan.playing(0);
    render(&mut engine, 1);
    assert!(engine.load(0, plan.plan()));
    assert_eq!(engine.track_mut(0).and_then(|track| track.carry(&carry_words(true, &[], &[]))), Some(1));
    assert!(engine.track(0).is_some_and(|track| track.voice_active(0)));
    // Held straight through: no fade, no restart.
    assert!(render(&mut engine, 2).iter().all(|&sample| sample == 1.0));
}

#[test]
fn a_param_ramps_over_its_own_length() {
    // The track plays param 0.
    let plan = PlanBuilder::new().voices(0).params(1).track_out(vec![param(0)]);
    let mut engine = plan.loaded();
    engine.track_mut(0).unwrap().init_param(0, 0.0);
    engine.track_mut(0).unwrap().set_ramp(0, 4 * BLOCK);
    engine.track_mut(0).unwrap().set_param(0, 1.0);
    let out = render(&mut engine, 5);
    // TS: out.forEach((sample, index) => expect(sample).toBeCloseTo(Math.min((index + 1) / (4 * BLOCK), 1)))
    out.iter().enumerate().for_each(|(index, &sample)| {
        let expected = ((index + 1) as f32 / (4 * BLOCK) as f32).min(1.0);
        assert!((sample - expected).abs() < 1e-6, "sample {index}: {sample}, expected {expected}");
    });
    // A change halfway through a ramp starts from where it had got to.
    engine.track_mut(0).unwrap().set_param(0, 0.0);
    render(&mut engine, 2);
    engine.track_mut(0).unwrap().set_param(0, 1.0);
    let turned = render(&mut engine, 1);
    assert!((turned[0] - (0.5 + 0.5 / (4 * BLOCK) as f32)).abs() < 1e-6);
}
