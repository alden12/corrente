//! The router's behaviour, checked against answers worked out by hand: sample-accurate note starts,
//! one-sample feedback, a delay loop run in chunks, voices freeing after their release, the shared
//! section, stereo and multi-output blocks, effects after the voices, audio inputs, independent
//! tracks, and plans the engine must refuse. `yarn engine:test` runs them.
//!
//! Rust notes, for reading this file:
//! - `#[test]` marks a function the test runner calls; `assert_eq!` and `assert!` fail the test.
//! - `PlanBuilder` writes plans in the same int32 words the TypeScript compiler will, so these tests
//!   go through the real parser too.

use crate::faust;
use crate::plan::{self, KIND_DELAY, SIGNAL_GATE};
use crate::router::{BLOCK, Engine};

const RATE: i32 = 48000;

/// One input: (type, index, extra), as the plan words carry it.
// TS: type Input = [type: number, index: number, extra: number]. `(i32, i32, i32)` is a tuple.
type Input = (i32, i32, i32);

// TS: const buffer = (node: number): Input => [0, node, 0]; and so on. A tuple is written `(a, b, c)`.
/// A node's first output, in the same section.
fn buffer(node: i32) -> Input {
    (0, node, 0)
}
/// A node's output `port`, in the same section.
fn port(node: i32, port: i32) -> Input {
    (0, node, port)
}
fn previous(node: i32) -> Input {
    (1, node, 0)
}
// `.to_bits()` is the float's bit pattern, as the plan carries it.
fn constant(value: f32) -> Input {
    (3, 0, value.to_bits() as i32)
}
fn voice(signal: usize) -> Input {
    (4, signal as i32, 0)
}
/// A pre section node's first output.
fn shared(node: i32) -> Input {
    (5, node, 0)
}
fn voice_sum(channel: i32) -> Input {
    (6, channel, 0)
}
fn input(channel: i32) -> Input {
    (7, channel, 0)
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

/// Which section a node or step goes in.
// TS: const PRE = 0, VOICE = 1, POST = 2
const PRE: usize = 0;
const VOICE: usize = 1;
const POST: usize = 2;

// TS: interface SectionWords { nodes: [kind: number, audio: Input[], control: Input[]][]; steps: [mode: number, members: number[]][] }
// `#[derive(Default)]` writes `SectionWords::default()` for us: both lists empty.
#[derive(Default)]
struct SectionWords {
    nodes: Vec<(i32, Vec<Input>, Vec<Input>)>,
    steps: Vec<(i32, Vec<i32>)>,
}

// TS: class PlanBuilder { voices = 4; sections = [new SectionWords(), ...]; voiceOut: Input[] = []; trackOut = [voiceSum(0), voiceSum(1)] }
struct PlanBuilder {
    voices: i32,
    sections: [SectionWords; 3],
    voice_out: Vec<Input>,
    track_out: Vec<Input>,
}

impl PlanBuilder {
    /// A plan with 4 voices, whose track plays the voices' sum.
    fn new() -> Self {
        PlanBuilder { voices: 4, sections: Default::default(), voice_out: vec![], track_out: vec![voice_sum(0), voice_sum(1)] }
    }

    // TS: voices(count) { this.voices = count; return this }
    // `mut self` (no `&`) takes the builder by value, changes it and hands it back, so calls chain:
    // `PlanBuilder::new().node(...).step(...)`.
    fn voices(mut self, count: i32) -> Self {
        self.voices = count;
        self
    }

    // TS: nodeIn(section, kind, audio, control) { this.sections[section].nodes.push([kind, audio, control]); return this }
    fn node_in(mut self, section: usize, kind: i32, audio: Vec<Input>, control: Vec<Input>) -> Self {
        self.sections[section].nodes.push((kind, audio, control));
        self
    }

    fn step_in(mut self, section: usize, mode: i32, nodes: Vec<i32>) -> Self {
        self.sections[section].steps.push((mode, nodes));
        self
    }

    /// A node in the voice section, the one most tests use.
    fn node(self, kind: i32, audio: Vec<Input>, control: Vec<Input>) -> Self {
        self.node_in(VOICE, kind, audio, control)
    }

    fn step(self, mode: i32, nodes: Vec<i32>) -> Self {
        self.step_in(VOICE, mode, nodes)
    }

    /// Each voice plays this, in both channels.
    fn out(mut self, source: Input) -> Self {
        self.voice_out = vec![source];
        self
    }

    fn voice_out(mut self, sources: Vec<Input>) -> Self {
        self.voice_out = sources;
        self
    }

    fn track_out(mut self, sources: Vec<Input>) -> Self {
        self.track_out = sources;
        self
    }

    /// The plan's words.
    // TS:
    //   words(): number[] {
    //     const inputWords = (inputs: Input[]) => inputs.flat();
    //     const sections = this.sections.flatMap((section) => [section.nodes.length, section.steps.length, ...nodes, ...steps]);
    //     return [0, this.voices, ...sections, this.voiceOut.length, ...inputWords(this.voiceOut), this.trackOut.length, ...inputWords(this.trackOut)];
    //   }
    // `flat_map` is flatMap; `[a, b].concat()` joins lists. `|&(kind, index, extra)|` destructures a
    // tuple, copying it out of its reference.
    fn words(&self) -> Vec<i32> {
        let input_words = |inputs: &[Input]| -> Vec<i32> { inputs.iter().flat_map(|&(kind, index, extra)| [kind, index, extra]).collect() };
        let outputs = |sources: &[Input]| [vec![sources.len() as i32], input_words(sources)].concat();
        let sections = self.sections.iter().flat_map(|section| {
            let nodes = section.nodes.iter().flat_map(|(kind, audio, control)| {
                [vec![*kind, audio.len() as i32, control.len() as i32], input_words(audio), input_words(control)].concat()
            });
            let steps = section.steps.iter().flat_map(|(mode, members)| [vec![*mode, members.len() as i32], members.clone()].concat());
            [section.nodes.len() as i32, section.steps.len() as i32].into_iter().chain(nodes).chain(steps).collect::<Vec<i32>>()
        });
        [0, self.voices].into_iter().chain(sections).chain(outputs(&self.voice_out)).chain(outputs(&self.track_out)).collect()
    }

    /// The plan, parsed: the test fails here if the engine would refuse it.
    fn plan(&self) -> plan::Plan {
        plan::parse(&self.words()).expect("a valid plan")
    }

    // TS: expect(() => parse(this.words())).toThrow(REJECTED)
    // `.err()` turns a Result into an Option of its error (None if it succeeded), so it compares.
    fn refused(&self) -> bool {
        plan::parse(&self.words()).err() == Some(plan::REJECTED)
    }

    /// An engine of one track with this plan loaded and a note playing in slot 0 from `offset`.
    // TS: const engine = loaded(this); engine.noteOn(0, 0, offset, 440, 1); return engine;
    fn playing(&self, offset: i32) -> Engine {
        let mut engine = self.loaded();
        engine.note_on(0, 0, offset, 440.0, 1.0);
        engine
    }

    /// An engine of one track with this plan loaded, and nothing playing.
    fn loaded(&self) -> Engine {
        let mut engine = Engine::new();
        engine.init(RATE, 1);
        assert!(engine.load(0, self.plan()));
        engine
    }
}

/// Render `blocks` blocks and return a track's output channel, end to end.
// TS: Array.from({ length: blocks }).flatMap(() => { engine.process(); return [...engine.output(track, channel)] })
// `.to_vec()` copies the engine's block into a new list we own.
fn render_channel(engine: &mut Engine, track: usize, channel: usize, blocks: usize) -> Vec<f32> {
    (0..blocks)
        .flat_map(|_| {
            engine.process();
            engine.output(track, channel).expect("a track and channel that exist").to_vec()
        })
        .collect()
}

/// Render `blocks` blocks and return track 0's left channel.
fn render(engine: &mut Engine, blocks: usize) -> Vec<f32> {
    render_channel(engine, 0, 0, blocks)
}

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
    engine.note_on(0, 0, 0, 440.0, 1.0);
    assert!(render(&mut engine, 2).iter().any(|&sample| sample.abs() > 0.1));
}

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
    engine.note_on(0, 1, 0, 220.0, 1.0);
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
    engine.note_on(0, 1, 0, 220.0, 1.0);
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
    engine.note_on(1, 0, 0, 440.0, 1.0);
    engine.process();
    assert!(engine.output(0, 0).unwrap().iter().all(|&sample| sample == 0.0));
    assert!(engine.output(1, 0).unwrap().iter().all(|&sample| sample == 0.5));
    // A track that doesn't exist takes no plan.
    assert!(!engine.load(2, gate.plan()));
}

#[test]
fn bad_plans_are_refused() {
    let mul = |audio: Vec<Input>| PlanBuilder::new().node(kind("mul"), audio, vec![]).step(NODE, vec![0]).out(buffer(0));
    assert!(plan::parse(&mul(vec![constant(1.0), constant(1.0)]).words()).is_ok());

    let unknown_kind = PlanBuilder::new().node(999, vec![], vec![]).step(NODE, vec![0]);
    assert!(unknown_kind.refused());
    assert!(mul(vec![constant(1.0)]).refused(), "the wrong number of inputs");
    assert!(mul(vec![buffer(5), constant(1.0)]).refused(), "a node that doesn't exist");
    assert!(mul(vec![port(0, 1), constant(1.0)]).refused(), "an output the node doesn't have");
    assert!(mul(vec![constant(1.0), constant(1.0)]).out(port(0, 1)).refused(), "the voice playing an output that doesn't exist");

    let not_run = PlanBuilder::new().node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![]);
    assert!(not_run.refused(), "a node that never runs");

    assert!(mul(vec![constant(1.0), constant(1.0)]).voices(65).refused(), "too many voices");
    let three_channels = mul(vec![constant(1.0), constant(1.0)]).voice_out(vec![buffer(0), buffer(0), buffer(0)]);
    assert!(three_channels.refused(), "more than two output channels");

    let mut words_left_over = mul(vec![constant(1.0), constant(1.0)]).words();
    words_left_over.push(0);
    assert_eq!(plan::parse(&words_left_over).err(), Some(plan::WRONG_LENGTH));
}

#[test]
fn sections_only_read_what_they_can_see() {
    // A voice's signals outside the voice section.
    let gate_in_pre = PlanBuilder::new().node_in(PRE, kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step_in(PRE, NODE, vec![0]);
    assert!(gate_in_pre.refused());
    // The voice sum before the voices have run.
    let sum_in_voice = PlanBuilder::new().node(kind("mul"), vec![voice_sum(0), constant(1.0)], vec![]).step(NODE, vec![0]);
    assert!(sum_in_voice.refused());
    // The pre section reading itself as if it were shared.
    let shared_in_pre = PlanBuilder::new()
        .node_in(PRE, kind("mul"), vec![constant(1.0), constant(1.0)], vec![])
        .node_in(PRE, kind("mul"), vec![shared(0), constant(1.0)], vec![])
        .step_in(PRE, NODE, vec![0])
        .step_in(PRE, NODE, vec![1]);
    assert!(shared_in_pre.refused());
    // A feedback edge as an output.
    let previous_out = PlanBuilder::new().node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![]).step(NODE, vec![0]).out(previous(0));
    assert!(previous_out.refused());
}

#[test]
fn plans_in_the_wrong_order_are_refused() {
    // The delay loop from above, with the add before the multiply it reads: it would play, but
    // every echo a chunk late.
    let misordered = PlanBuilder::new()
        .node(kind("add"), vec![constant(1.0), buffer(2)], vec![])
        .node(KIND_DELAY, vec![buffer(0), constant(40.0)], vec![])
        .node(kind("mul"), vec![buffer(1), constant(0.5)], vec![])
        .step(CHUNK_LOOP, vec![1, 0, 2]);
    assert!(misordered.refused());

    // A node reading one that runs after it.
    let backwards = PlanBuilder::new()
        .node(kind("mul"), vec![buffer(1), constant(1.0)], vec![])
        .node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![])
        .step(NODE, vec![0])
        .step(NODE, vec![1]);
    assert!(backwards.refused());

    // A feedback edge outside a loop.
    let stray_feedback = PlanBuilder::new().node(kind("mul"), vec![previous(0), constant(1.0)], vec![]).step(NODE, vec![0]);
    assert!(stray_feedback.refused());
}
