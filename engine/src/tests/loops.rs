//! Feedback loops: one sample at a time, and in chunks cut by a delay.

use super::*;

// TS: expect(output.slice(0, 4)).toEqual([1, 1.5, 1.75, 1.875])
// `&output[..4]` lends the first four; `&[...]` is a borrowed array literal to compare against.
#[test]
fn feedback_in_a_loop_takes_one_sample() {
    // y[n] = 1 + 0.5 * y[n - 1]: 1, 1.5, 1.75, ... towards 2. Web Audio could only do this with a
    // whole block (128 samples) of delay in the loop.
    let plan = PlanBuilder::new()
        .node(kind("add"), vec![constant(1.0), previous(1)], vec![])
        .node(kind("mul"), vec![buffer(0), constant(0.5)], vec![])
        .step(SAMPLE_LOOP, vec![0, 1])
        .out(buffer(0));
    let mut engine = plan.playing(0);
    let output = render(&mut engine, 1);
    assert_eq!(&output[..4], &[1.0, 1.5, 1.75, 1.875]);
    assert!((output[BLOCK - 1] - 2.0).abs() < 1e-6);
}

#[test]
fn a_delay_loop_runs_in_chunks_and_echoes_on_time() {
    // y[n] = 1 + 0.5 * y[n - 40]: steps up every 40 samples. Run in chunks no longer than the delay,
    // so each echo has to land on exactly the right sample.
    let plan = PlanBuilder::new()
        .node(kind("add"), vec![constant(1.0), buffer(2)], vec![])
        .node(KIND_DELAY, vec![buffer(0), constant(40.0)], vec![])
        .node(kind("mul"), vec![buffer(1), constant(0.5)], vec![])
        // Delays first (they only read what they were given before), then the rest in dependency
        // order: the multiply reads the delay, the add reads the multiply.
        .step(CHUNK_LOOP, vec![1, 2, 0])
        .out(buffer(0));
    let mut engine = plan.playing(0);
    let output = render(&mut engine, 2);
    // TS: const expected = (n: number) => sum over echo = 0..floor(n / 40) of 0.5 ** echo
    // `(0..=x)` includes x; `n / 40` on integers rounds down. `.sum::<f32>()` names what to sum into.
    let expected = |n: usize| (0..=n / 40).map(|echo| 0.5f32.powi(echo as i32)).sum::<f32>();
    // `"sample {n}: ..."` after the condition is the failure message, formatted like `format!`.
    output.iter().enumerate().for_each(|(n, &sample)| {
        assert!((sample - expected(n)).abs() < 1e-6, "sample {n}: {sample}, expected {}", expected(n));
    });
}

#[test]
fn a_delay_holds_as_long_as_its_size_and_no_longer() {
    // An impulse into a delay `length` samples long, the ring `size` (a literal in the plan).
    let echo = |size: Option<f32>, length: f32| {
        let controls = size.map_or(vec![], |size| vec![constant(size)]);
        PlanBuilder::new().voices(0).node_in(POST, KIND_DELAY, vec![input(0), constant(length)], controls).step_in(POST, NODE, vec![0]).track_out(vec![buffer(0)])
    };
    let first_sound = |plan: PlanBuilder, blocks: usize| {
        let mut engine = plan.loaded();
        engine.input_mut(0, 0).expect("track 0")[0] = 1.0;
        let out = render(&mut engine, blocks);
        out.iter().position(|&sample| sample != 0.0)
    };
    // A second at 48 kHz, in a ring sized for it.
    assert_eq!(first_sound(echo(Some(48000.0), 48000.0), 400), Some(48000));
    // Without a size, the ring holds 4094 samples, so a longer delay is cut to that.
    assert_eq!(first_sound(echo(None, 48000.0), 40), Some(4094));
}
