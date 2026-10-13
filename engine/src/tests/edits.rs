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
fn a_cut_voice_fades_out_over_a_block_and_frees_its_slot() {
    // The gate as the output: 1 while the note is held.
    let plan = PlanBuilder::new().node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    let mut engine = plan.playing(0);
    render(&mut engine, 1);
    engine.cut(0, 0, 32);
    let cut = render(&mut engine, 2);
    assert!(cut[..32].iter().all(|&sample| sample == 1.0));
    // TS: each sample after the cut starts is a step lower, down to 0 a block later.
    cut[32..32 + BLOCK].iter().enumerate().for_each(|(index, &sample)| {
        assert!((sample - (1.0 - (index + 1) as f32 / BLOCK as f32)).abs() < 1e-6);
    });
    assert!(cut[32 + BLOCK..].iter().all(|&sample| sample == 0.0));
    assert!(!engine.voice_active(0, 0));
}

#[test]
fn a_plan_has_spare_voice_slots_for_notes_that_start_while_others_fade() {
    let engine = PlanBuilder::new().voices(4).node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0)).loaded();
    assert_eq!(engine.voice_slots(0), Some(8));
}
