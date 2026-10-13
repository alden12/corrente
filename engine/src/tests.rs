//! The router's behaviour, checked against answers worked out by hand: sample-accurate note starts,
//! one-sample feedback, a delay loop run in chunks, voices freeing after their release, and plans
//! the engine must refuse. `yarn engine:test` runs them.
//!
//! Rust notes, for reading this file:
//! - `#[test]` marks a function the test runner calls; `assert_eq!` and `assert!` fail the test.
//! - `PlanBuilder` writes plans in the same int32 words the TypeScript compiler will, so these tests
//!   go through the real parser too.

// TS: import { faust } from "./faust"; import { plan, KIND_DELAY, SIGNAL_GATE } from "./plan"; ...
use crate::faust;
use crate::plan::{self, KIND_DELAY, SIGNAL_GATE};
use crate::router::{BLOCK, Engine};

const RATE: i32 = 48000;

/// One input: (source type, index, value), as the plan words carry it.
// TS: type Input = [type: number, index: number, value: number]. `(i32, i32, f32)` is a tuple.
type Input = (i32, i32, f32);

// TS: const buffer = (node: number): Input => [0, node, 0]; and so on. A tuple is written `(a, b, c)`.
fn buffer(node: i32) -> Input {
    (0, node, 0.0)
}
fn previous(node: i32) -> Input {
    (1, node, 0.0)
}
fn constant(value: f32) -> Input {
    (3, 0, value)
}
fn voice(signal: usize) -> Input {
    (4, signal as i32, 0.0)
}

/// A Faust block's kind number, by name.
// TS: const index = faust.NAMES.indexOf(name); if (index < 0) throw new Error("a block with that name"); return index;
// `.position(f)` is findIndex, giving an Option. `*candidate` reads the name through its reference.
fn kind(name: &str) -> i32 {
    faust::NAMES.iter().position(|candidate| *candidate == name).expect("a block with that name") as i32
}

const NODE: i32 = 0;
const SAMPLE_LOOP: i32 = 1;
const CHUNK_LOOP: i32 = 2;

// TS: class PlanBuilder { nodes: [kind: number, audio: Input[], control: Input[]][] = []; steps: [mode: number, members: number[]][] = [] }
// `#[derive(Default)]` writes `PlanBuilder::default()` for us: both lists empty.
#[derive(Default)]
struct PlanBuilder {
    nodes: Vec<(i32, Vec<Input>, Vec<Input>)>,
    steps: Vec<(i32, Vec<i32>)>,
}

impl PlanBuilder {
    // TS: node(kind, audio, control) { this.nodes.push([kind, audio, control]); return this }
    // `mut self` (no `&`) takes the builder by value, changes it and hands it back, so calls chain:
    // `PlanBuilder::default().node(...).step(...)`.
    fn node(mut self, kind: i32, audio: Vec<Input>, control: Vec<Input>) -> Self {
        self.nodes.push((kind, audio, control));
        self
    }

    fn step(mut self, mode: i32, nodes: Vec<i32>) -> Self {
        self.steps.push((mode, nodes));
        self
    }

    /// The plan's words, with `out` as the voice's output node.
    // TS:
    //   words(out: number): number[] {
    //     const inputWords = (inputs: Input[]) => inputs.flatMap(([type, index, value]) => [type, index, floatBits(value)]);
    //     const header = [this.nodes.length, 0, this.steps.length, out];
    //     const nodes = this.nodes.flatMap(([kind, audio, control]) => [kind, audio.length, control.length, ...inputWords(audio), ...inputWords(control)]);
    //     const steps = this.steps.flatMap(([mode, members]) => [mode, members.length, ...members]);
    //     return [...header, ...nodes, ...steps];
    //   }
    // `.to_bits()` is the float's bit pattern; `flat_map` is flatMap; `[a, b].concat()` joins lists.
    // `|&(kind, index, value)|` destructures a tuple, copying it out of its reference.
    fn words(&self, out: i32) -> Vec<i32> {
        let input_words = |inputs: &[Input]| -> Vec<i32> {
            inputs.iter().flat_map(|&(kind, index, value)| [kind, index, value.to_bits() as i32]).collect()
        };
        let header = [self.nodes.len() as i32, 0, self.steps.len() as i32, out];
        let nodes = self.nodes.iter().flat_map(|(kind, audio, control)| {
            [vec![*kind, audio.len() as i32, control.len() as i32], input_words(audio), input_words(control)].concat()
        });
        let steps = self.steps.iter().flat_map(|(mode, members)| [vec![*mode, members.len() as i32], members.clone()].concat());
        header.into_iter().chain(nodes).chain(steps).collect()
    }

    /// An engine with this plan loaded and a note playing in slot 0 from `offset`, at velocity 1.
    // TS: const engine = new Engine(); engine.init(RATE, 4); engine.load(parse(this.words(out))); engine.noteOn(0, offset, 440, 1); return engine;
    fn playing(&self, out: i32, offset: i32) -> Engine {
        let mut engine = Engine::new();
        engine.init(RATE, 4);
        engine.load(plan::parse(&self.words(out)).expect("a valid plan"));
        engine.note_on(0, offset, 440.0, 1.0);
        engine
    }
}

/// Render `blocks` blocks and return them end to end.
// TS: Array.from({ length: blocks }).flatMap(() => [...engine.process()])
// `.to_vec()` copies the engine's block into a new list we own.
fn render(engine: &mut Engine, blocks: usize) -> Vec<f32> {
    (0..blocks).flat_map(|_| engine.process().to_vec()).collect()
}

// TS: it("a note starts on its sample", () => { ... })
// `output[..37]` is output.slice(0, 37); `output[37..]` is output.slice(37).
// `|&sample| sample == 0.0`: `&sample` copies the number out of the reference the iterator gives.
#[test]
fn a_note_starts_on_its_sample() {
    // The gate itself as the output: 0 until the note, then 1.
    let plan = PlanBuilder::default()
        .node(kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![])
        .step(NODE, vec![0]);
    let mut engine = plan.playing(0, 37);
    let output = render(&mut engine, 1);
    assert!(output[..37].iter().all(|&sample| sample == 0.0));
    assert!(output[37..].iter().all(|&sample| sample == 1.0));
}

// `.unwrap()` is `.expect()` without a message: the value, or stop the test.
#[test]
fn nothing_sounds_until_a_note_plays() {
    let plan = PlanBuilder::default().node(kind("saw"), vec![voice(0)], vec![]).step(NODE, vec![0]);
    let mut engine = Engine::new();
    engine.init(RATE, 4);
    engine.load(plan::parse(&plan.words(0)).unwrap());
    assert!(render(&mut engine, 2).iter().all(|&sample| sample == 0.0));
    engine.note_on(0, 0, 440.0, 1.0);
    assert!(render(&mut engine, 2).iter().any(|&sample| sample.abs() > 0.1));
}

// TS: expect(output.slice(0, 4)).toEqual([1, 1.5, 1.75, 1.875])
// `&output[..4]` lends the first four; `&[...]` is a borrowed array literal to compare against.
#[test]
fn feedback_in_a_loop_takes_one_sample() {
    // y[n] = 1 + 0.5 * y[n - 1]: 1, 1.5, 1.75, ... towards 2. Web Audio could only do this with a
    // whole block (128 samples) of delay in the loop.
    let plan = PlanBuilder::default()
        .node(kind("add"), vec![constant(1.0), previous(1)], vec![])
        .node(kind("mul"), vec![buffer(0), constant(0.5)], vec![])
        .step(SAMPLE_LOOP, vec![0, 1]);
    let mut engine = plan.playing(0, 0);
    let output = render(&mut engine, 1);
    assert_eq!(&output[..4], &[1.0, 1.5, 1.75, 1.875]);
    assert!((output[BLOCK - 1] - 2.0).abs() < 1e-6);
}

#[test]
fn a_delay_loop_runs_in_chunks_and_echoes_on_time() {
    // y[n] = 1 + 0.5 * y[n - 40]: steps up every 40 samples. Run in chunks no longer than the delay,
    // so each echo has to land on exactly the right sample.
    let plan = PlanBuilder::default()
        .node(kind("add"), vec![constant(1.0), buffer(2)], vec![])
        .node(KIND_DELAY, vec![buffer(0), constant(40.0)], vec![])
        .node(kind("mul"), vec![buffer(1), constant(0.5)], vec![])
        // Delays first (they only read what they were given before), then the rest in dependency
        // order: the multiply reads the delay, the add reads the multiply.
        .step(CHUNK_LOOP, vec![1, 2, 0]);
    let mut engine = plan.playing(0, 0);
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
fn a_released_voice_frees_its_slot_once_silent() {
    // A saw shaped by an envelope with a 10 ms release.
    let plan = PlanBuilder::default()
        .node(kind("saw"), vec![voice(0)], vec![])
        .node(kind("adsr"), vec![voice(SIGNAL_GATE)], vec![constant(0.001), constant(0.001), constant(1.0), constant(0.01)])
        .node(kind("mul"), vec![buffer(0), buffer(1)], vec![])
        .step(NODE, vec![0])
        .step(NODE, vec![1])
        .step(NODE, vec![2]);
    let mut engine = plan.playing(2, 0);
    render(&mut engine, 8);
    assert!(engine.voice_active(0));
    engine.note_off(0, 0);
    // 10 ms is 480 samples, under 4 blocks; give it 8.
    render(&mut engine, 8);
    assert!(!engine.voice_active(0));
}

// TS: expect(() => parse(words)).toThrow(REJECTED)
// `.err()` turns a Result into an Option of its error (None if it succeeded), so it can be compared.
#[test]
fn bad_plans_are_refused() {
    let good = PlanBuilder::default().node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![]).step(NODE, vec![0]);
    assert!(plan::parse(&good.words(0)).is_ok());

    let unknown_kind = PlanBuilder::default().node(999, vec![], vec![]).step(NODE, vec![0]);
    assert_eq!(plan::parse(&unknown_kind.words(0)).err(), Some(plan::REJECTED));

    let wrong_input_count = PlanBuilder::default().node(kind("mul"), vec![constant(1.0)], vec![]).step(NODE, vec![0]);
    assert_eq!(plan::parse(&wrong_input_count.words(0)).err(), Some(plan::REJECTED));

    let missing_node = PlanBuilder::default().node(kind("mul"), vec![buffer(5), constant(1.0)], vec![]).step(NODE, vec![0]);
    assert_eq!(plan::parse(&missing_node.words(0)).err(), Some(plan::REJECTED));

    let not_run = PlanBuilder::default().node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![]);
    assert_eq!(plan::parse(&not_run.words(0)).err(), Some(plan::REJECTED));

    let mut words_left_over = good.words(0);
    words_left_over.push(0);
    assert_eq!(plan::parse(&words_left_over).err(), Some(plan::WRONG_LENGTH));
}

#[test]
fn plans_in_the_wrong_order_are_refused() {
    // The delay loop from above, with the add before the multiply it reads: it would play, but
    // every echo a chunk late.
    let misordered = PlanBuilder::default()
        .node(kind("add"), vec![constant(1.0), buffer(2)], vec![])
        .node(KIND_DELAY, vec![buffer(0), constant(40.0)], vec![])
        .node(kind("mul"), vec![buffer(1), constant(0.5)], vec![])
        .step(CHUNK_LOOP, vec![1, 0, 2]);
    assert_eq!(plan::parse(&misordered.words(0)).err(), Some(plan::REJECTED));

    // A node reading one that runs after it.
    let backwards = PlanBuilder::default()
        .node(kind("mul"), vec![buffer(1), constant(1.0)], vec![])
        .node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![])
        .step(NODE, vec![0])
        .step(NODE, vec![1]);
    assert_eq!(plan::parse(&backwards.words(0)).err(), Some(plan::REJECTED));

    // A feedback edge outside a loop.
    let stray_feedback = PlanBuilder::default()
        .node(kind("mul"), vec![previous(0), constant(1.0)], vec![])
        .step(NODE, vec![0]);
    assert_eq!(plan::parse(&stray_feedback.words(0)).err(), Some(plan::REJECTED));
}
