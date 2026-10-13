//! The router's behaviour, checked against answers worked out by hand: sample-accurate note starts,
//! one-sample feedback, a delay loop run in chunks, voices freeing after their release, the shared
//! section, stereo and multi-output blocks, effects after the voices, audio inputs, independent
//! tracks, and plans the engine must refuse. `yarn engine:test` runs them.
//!
//! This file holds `PlanBuilder` and the helpers; the tests are in the files beside it, by topic.
//!
//! Rust notes, for reading this folder:
//! - `use super::*;` at the top of each test file brings in everything from this one: the helpers,
//!   and what this file itself imports.
//! - `#[test]` marks a function the test runner calls; `assert_eq!` and `assert!` fail the test.
//! - `PlanBuilder` writes plans in the same int32 words the TypeScript compiler will, so these tests
//!   go through the real parser too.


mod loops;
mod playing;
mod refusals;
mod sections;

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
