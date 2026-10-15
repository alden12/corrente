//! The wavetable oscillator: a cycle read at the note's frequency, morphed between cycles by
//! position, from the band-limited level its frequency allows.

use super::*;
use crate::router::{CYCLE, LEVELS};

/// A voice playing a wavetable from slot 0 at the note's frequency, `position` fixed.
// TS: const wavetable = (position) => new PlanBuilder().node(KIND_WAVETABLE, [voice(FREQ), constant(position)], [constant(0)]).step(NODE, [0]).out(buffer(0))
fn wavetable(position: f32) -> PlanBuilder {
    PlanBuilder::new().node(KIND_WAVETABLE, vec![voice(SIGNAL_FREQ), constant(position)], vec![constant(0.0)]).step(NODE, vec![0]).out(buffer(0))
}

/// Put a table in slot 0: `cycle(level, cycle, index)` for every level, cycle and sample of a cycle.
// TS: engine.reserveSample(0, LEVELS * cycles * CYCLE, 1, RATE).forEach((_, at, data) => (data[at] = cycle(level, n, index)))
fn table(engine: &mut Engine, cycles: usize, cycle: impl Fn(usize, usize, usize) -> f32) {
    let data = engine.reserve_sample(0, LEVELS * cycles * CYCLE, 1, RATE as f32).expect("room for the table");
    data.iter_mut().enumerate().for_each(|(at, value)| *value = cycle(at / (cycles * CYCLE), at / CYCLE % cycles, at % CYCLE));
}

/// One cycle a period: at this frequency a 2048-sample cycle at 48 kHz moves on one sample a sample.
const ONE_A_SAMPLE: f32 = RATE as f32 / CYCLE as f32;

fn near(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-4
}

#[test]
fn reads_a_cycle_round_at_the_notes_frequency() {
    let mut engine = wavetable(0.0).loaded();
    table(&mut engine, 1, |_, _, index| index as f32 / CYCLE as f32);
    engine.track_mut(0).unwrap().note_on(0, 0, ONE_A_SAMPLE, 1.0, 0.0);
    let out = render(&mut engine, 1);
    assert!(out.iter().enumerate().all(|(index, &sample)| near(sample, index as f32 / CYCLE as f32)));
    // Twice the frequency, twice as fast.
    engine.track_mut(0).unwrap().note_on(0, 0, 2.0 * ONE_A_SAMPLE, 1.0, 0.0);
    let out = render(&mut engine, 1);
    assert!(out.iter().enumerate().all(|(index, &sample)| near(sample, 2.0 * index as f32 / CYCLE as f32)));
}

#[test]
fn morphs_between_cycles_by_position() {
    // Three cycles, flat at 0, 1 and 2: a quarter of the way is half way between the first two.
    let mut engine = wavetable(0.25).playing(0);
    table(&mut engine, 3, |_, cycle, _| cycle as f32);
    assert!(render(&mut engine, 1).iter().all(|&sample| near(sample, 0.5)));
}

#[test]
fn reads_the_brightest_level_that_stays_under_half_the_sample_rate() {
    // Each level flat at its own number, so what plays says which level was read.
    let level_at = |frequency: f32| {
        let mut engine = wavetable(0.0).loaded();
        table(&mut engine, 1, |level, _, _| level as f32);
        engine.track_mut(0).unwrap().note_on(0, 0, frequency, 1.0, 0.0);
        render(&mut engine, 1)[0]
    };
    // 1024 harmonics of 23 Hz fit under 24 kHz; at 1 kHz, 16 do (level 6); at 12 kHz, 2 (level 9).
    assert_eq!(level_at(ONE_A_SAMPLE), 0.0);
    assert_eq!(level_at(1000.0), 6.0);
    assert_eq!(level_at(12000.0), 9.0);
    assert_eq!(level_at(23000.0), 10.0);
}

#[test]
fn a_slot_that_isnt_a_table_plays_silence() {
    let mut engine = wavetable(0.0).playing(0);
    engine.reserve_sample(0, 1000, 1, RATE as f32).expect("room").fill(0.5);
    assert!(render(&mut engine, 1).iter().all(|&sample| sample == 0.0));
    let missing_control = PlanBuilder::new().node(KIND_WAVETABLE, vec![voice(SIGNAL_FREQ), constant(0.0)], vec![]).step(NODE, vec![0]).out(buffer(0));
    assert!(missing_control.refused());
}
