//! The signals a plan reads besides its nodes: each voice's note number and seed, and the host's
//! transport.

use super::*;

/// A plan whose voice plays one of its signals, through a `mul` by 1.
// TS: const playingSignal = (signal: number) => new PlanBuilder().node(kind("mul"), [voice(signal), constant(1)], []).step(NODE, [0]).out(buffer(0))
fn playing_signal(signal: usize) -> PlanBuilder {
    PlanBuilder::new().node(kind("mul"), vec![voice(signal), constant(1.0)], vec![]).step(NODE, vec![0]).out(buffer(0))
}

#[test]
fn a_voice_reads_its_note_number() {
    let mut engine = playing_signal(SIGNAL_NOTE).loaded();
    engine.note_on(0, 0, 0, 261.63, 1.0, 60.0);
    assert!(render(&mut engine, 1).iter().all(|&sample| sample == 60.0));
}

#[test]
fn each_note_gets_its_own_seed_the_same_every_run() {
    // TS: const seeds = () => { const engine = loaded(); return [0, 1, 2].map((slot) => { engine.noteOn(0, slot, 0, 440, 1, 69); engine.process(); ... }) }
    let seeds = || -> Vec<f32> {
        let mut engine = playing_signal(SIGNAL_SEED).loaded();
        (0..3)
            .map(|slot| {
                engine.note_on(0, slot, 0, 440.0, 1.0, 69.0);
                engine.process();
                // The voices sum, so each new seed is the total less what was there before.
                engine.output(0, 0).expect("track 0")[0]
            })
            .collect()
    };
    let totals = seeds();
    let each = [totals[0], totals[1] - totals[0], totals[2] - totals[1]];
    assert!(each.iter().all(|&seed| (0.0..1.0).contains(&seed)));
    assert!(each[0] != each[1] && each[1] != each[2]);
    assert_eq!(seeds(), totals);
}

#[test]
fn the_host_signals_follow_the_transport() {
    // A track with no voices playing the host's beat on the left and its beat length in samples on the
    // right.
    let plan = PlanBuilder::new().voices(0).track_out(vec![host(HOST_BEAT), host(HOST_BEAT_SAMPLES)]);
    let mut engine = plan.loaded();
    engine.set_transport(4.0, 120.0, true);
    let beats = render_channel(&mut engine, 0, 0, 2);
    // 120 beats a minute is 2 a second, so a sample is 2 / 48000 of a beat, and the beat runs on into
    // the next block.
    beats.iter().enumerate().for_each(|(index, &beat)| assert!((beat - (4.0 + index as f32 * 2.0 / 48000.0)).abs() < 1e-4));
    assert_eq!(engine.output(0, 1).expect("track 0")[0], 24000.0);
    let playing = PlanBuilder::new().voices(0).track_out(vec![host(HOST_PLAYING)]);
    let mut engine = playing.loaded();
    engine.set_transport(0.0, 90.0, false);
    assert!(render(&mut engine, 1).iter().all(|&sample| sample == 0.0));
}
