//! MIDI devices in the engine (INST-11.1, crate::midi): chains read from words as midi/compile.ts
//! writes them, then played block by block as a track plays them. The octavator and an arpeggiator
//! are built from nodes here; the clock is checked against a transport driven as a host drives it.

use crate::midi::{self, BlockTransport, Chain, Event};

/// At 120 beats a minute and 48 kHz, beats a sample, and an eighth's length in samples.
const PER_SAMPLE: f64 = 2.0 / 48000.0;
const EIGHTH: u64 = 12000;
const C: i32 = 60;
const E: i32 = 64;
const G: i32 = 67;

const INPUT: f64 = 0.0;
const CLOCK: f64 = 1.0;
const PICK: f64 = 2.0;
const STACK: f64 = 3.0;
const TRANSPOSE: f64 = 4.0;
const VELOCITY: f64 = 5.0;

// TS: const fixed = (value: number) => [0, value]; const bound = (value: number) => [1, value, 1, 0, 0]; const random = (min, max) => [2, min, max]
fn fixed(value: f64) -> Vec<f64> {
    vec![0.0, value]
}
fn bound(value: usize) -> Vec<f64> {
    vec![1.0, value as f64, 1.0, 0.0, 0.0]
}
fn random(min: f64, max: f64) -> Vec<f64> {
    vec![2.0, min, max]
}

/// A node's words: its kind, each port's sources, its fields.
// TS: const node = (kind, ports, fields) => [kind, ports.length, ...ports.flatMap((sources) => [sources.length, ...sources]), fields.length, ...fields.flat()]
fn node(kind: f64, ports: &[&[usize]], fields: &[Vec<f64>]) -> Vec<f64> {
    let mut words = vec![kind, ports.len() as f64];
    ports.iter().for_each(|sources| {
        words.push(sources.len() as f64);
        words.extend(sources.iter().map(|&source| source as f64));
    });
    words.push(fields.len() as f64);
    fields.iter().for_each(|field| words.extend(field));
    words
}

/// A device's words: its bypass, its nodes, and which is its output.
fn device(bypass: Vec<f64>, nodes: &[Vec<f64>], output: usize) -> Vec<f64> {
    let mut words = bypass;
    words.extend([nodes.len() as f64, output as f64]);
    nodes.iter().for_each(|node| words.extend(node));
    words
}

/// A chain's words: how many values, the devices, then the values.
fn chain_words(values: &[f64], devices: &[Vec<f64>]) -> Vec<f64> {
    let mut words = vec![values.len() as f64, devices.len() as f64];
    devices.iter().for_each(|device| words.extend(device));
    words.extend(values);
    words
}

/// The octavator: copies an octave up and down, each switched by a value, at a level (values 0, 1, 2).
fn octavator() -> Vec<f64> {
    let copy = |interval: f64, on: Vec<f64>| [fixed(interval), bound(2), on];
    let mut fields = vec![fixed(0.0), fixed(1.0), fixed(1.0)];
    fields.extend(copy(12.0, bound(0)));
    fields.extend(copy(-12.0, bound(1)));
    device(fixed(0.0), &[node(INPUT, &[], &[]), node(STACK, &[&[0]], &fields)], 1)
}

/// An arpeggiator: a clock in eighths synced to the keys, picking up the held notes for half a step.
fn arpeggiator(direction: f64, octaves: f64) -> Vec<f64> {
    device(
        fixed(0.0),
        &[
            node(INPUT, &[], &[]),
            node(CLOCK, &[&[0]], &[fixed(0.5)]),
            node(PICK, &[&[0], &[1]], &[fixed(direction), fixed(octaves), fixed(0.5)]),
        ],
        2,
    )
}

fn parse(words: &[f64]) -> Chain {
    midi::parse(words).expect("the words make a chain")
}

/// Playing from beat 0 at 120.
fn steady(block: u64) -> BlockTransport {
    BlockTransport { beat: block as f64 * 128.0 * PER_SAMPLE, per_sample: PER_SAMPLE, playing: true }
}

/// Play `blocks` blocks, telling the chain `keys` (block, offset, event) as they come: every event it
/// sends the voices, as (sample time, event).
// TS: for (let n = 0; n < blocks; n++) { keys at n -> chain.key; chain.block(n * 128, transport(n)).forEach(...) }
fn run(chain: &mut Chain, blocks: u64, keys: &[(u64, i32, Event)], transport: impl Fn(u64) -> BlockTransport) -> Vec<(u64, Event)> {
    let mut played = Vec::new();
    for block in 0..blocks {
        keys.iter().filter(|(at, _, _)| *at == block).for_each(|&(_, offset, event)| chain.key(offset, event));
        let clock = block * 128;
        played.extend(chain.block(clock, transport(block)).iter().map(|&(offset, event)| (clock + offset as u64, event)));
    }
    played
}

fn on(note: i32) -> Event {
    Event::On { note, velocity: 1.0, length: None }
}
fn off(note: i32) -> Event {
    Event::Off { note }
}
// TS: played.filter(([, event]) => event.kind === "on").map(([time, event]) => [time, event.note])
fn ons(played: &[(u64, Event)]) -> Vec<(u64, i32)> {
    played.iter().filter_map(|&(time, event)| if let Event::On { note, .. } = event { Some((time, note)) } else { None }).collect()
}

#[test]
fn refuses_words_that_dont_make_a_chain() {
    let input = node(INPUT, &[], &[]);
    let refused = [
        // A kind the engine doesn't have.
        chain_words(&[], &[device(fixed(0.0), &[node(9.0, &[], &[])], 0)]),
        // A node reading one after it.
        chain_words(&[], &[device(fixed(0.0), &[node(TRANSPOSE, &[&[1]], &[fixed(1.0)]), input.clone()], 0)]),
        // A pick's ticks fed notes.
        chain_words(&[], &[device(fixed(0.0), &[input.clone(), node(PICK, &[&[0], &[0]], &[fixed(0.0), fixed(1.0), fixed(0.5)])], 1)]),
        // A device whose output is a clock.
        chain_words(&[], &[device(fixed(0.0), &[input.clone(), node(CLOCK, &[&[0]], &[fixed(0.5)])], 1)]),
        // A transpose with no semitones.
        chain_words(&[], &[device(fixed(0.0), &[input.clone(), node(TRANSPOSE, &[&[0]], &[])], 1)]),
        // A field reading a value the chain doesn't have.
        chain_words(&[], &[device(fixed(0.0), &[input.clone(), node(TRANSPOSE, &[&[0]], &[bound(0)])], 1)]),
    ];
    refused.iter().for_each(|words| assert!(midi::parse(words).is_none(), "{words:?}"));
    // Words left over.
    let mut extra = chain_words(&[], &[device(fixed(0.0), &[input], 0)]);
    extra.push(0.0);
    assert!(midi::parse(&extra).is_none());
}

#[test]
fn the_octavator_plays_its_copies_and_lets_go_of_the_same_notes() {
    // Up on, down off, level 0.5.
    let mut chain = parse(&chain_words(&[1.0, 0.0, 0.5], &[octavator()]));
    let played = run(&mut chain, 1, &[(0, 5, on(C)), (0, 90, off(C))], steady);
    let velocity = |note| played.iter().find_map(|&(_, event)| matches!(event, Event::On { note: on, .. } if on == note).then_some(event));
    assert_eq!(ons(&played), vec![(5, C), (5, C + 12)]);
    assert_eq!(velocity(C + 12), Some(Event::On { note: C + 12, velocity: 0.5, length: None }));
    assert!(played.contains(&(90, off(C))) && played.contains(&(90, off(C + 12))));
}

#[test]
fn a_note_lets_go_of_what_it_became_even_after_a_knob_moves() {
    let mut chain = parse(&chain_words(&[1.0, 0.0, 1.0], &[octavator()]));
    chain.key(0, on(C));
    chain.block(0, steady(0));
    // Octave up off, octave down on, before the key comes up.
    chain.set_value(0, 0.0);
    chain.set_value(1, 1.0);
    chain.key(10, off(C));
    let released: Vec<Event> = chain.block(128, steady(1)).iter().map(|&(_, event)| event).collect();
    assert_eq!(released, vec![off(C), off(C + 12)]);
}

#[test]
fn devices_chain_in_order_and_each_reads_its_own_fields() {
    let transpose = device(fixed(0.0), &[node(INPUT, &[], &[]), node(TRANSPOSE, &[&[0]], &[fixed(2.0)])], 1);
    let velocity = device(fixed(0.0), &[node(INPUT, &[], &[]), node(VELOCITY, &[&[0]], &[fixed(0.5)])], 1);
    let mut chain = parse(&chain_words(&[1.0, 0.0, 1.0], &[octavator(), transpose, velocity]));
    let played = run(&mut chain, 1, &[(0, 0, Event::On { note: C, velocity: 0.8, length: None })], steady);
    assert_eq!(
        played,
        vec![(0, Event::On { note: C + 2, velocity: 0.4, length: None }), (0, Event::On { note: C + 14, velocity: 0.4, length: None })]
    );
}

#[test]
fn bypassing_a_device_lets_go_of_what_it_moved_then_passes_notes_through() {
    // Value 3 is the device's bypass.
    let mut words = octavator();
    words.splice(0..2, bound(3));
    let mut chain = parse(&chain_words(&[1.0, 0.0, 1.0, 0.0], &[words]));
    chain.key(0, on(C));
    chain.block(0, steady(0));
    chain.set_value(3, 1.0);
    chain.key(20, on(E));
    let played: Vec<(usize, Event)> = chain.block(128, steady(1)).to_vec();
    assert_eq!(played, vec![(0, off(C)), (0, off(C + 12)), (20, on(E))]);
}

#[test]
fn the_arpeggiator_steps_on_the_grid_up_what_is_held_each_for_half_a_step() {
    let mut chain = parse(&chain_words(&[], &[arpeggiator(0.0, 1.0)]));
    let chord = [(0, 0, on(C)), (0, 0, on(E)), (0, 0, on(G))];
    let played = run(&mut chain, 300, &chord, steady);
    assert_eq!(ons(&played), vec![(0, C), (EIGHTH, E), (2 * EIGHTH, G), (3 * EIGHTH, C)]);
    assert!(played.contains(&(EIGHTH / 2, off(C))));
    assert!(played.contains(&(EIGHTH + EIGHTH / 2, off(E))));
}

#[test]
fn the_arpeggiator_walks_down_and_up_and_down_over_its_octaves() {
    let walk = |direction: f64, octaves: f64| {
        let mut chain = parse(&chain_words(&[], &[arpeggiator(direction, octaves)]));
        let played = run(&mut chain, 600, &[(0, 0, on(C)), (0, 0, on(E))], steady);
        ons(&played).into_iter().map(|(_, note)| note).take(6).collect::<Vec<_>>()
    };
    assert_eq!(walk(1.0, 1.0), vec![E, C, E, C, E, C]);
    assert_eq!(walk(2.0, 2.0), vec![C, E, C + 12, E + 12, C + 12, E]);
}

#[test]
fn a_key_after_a_step_in_the_same_block_is_not_heard_by_it() {
    // The second step is at 12000: block 93, offset 96.
    let second = |offset: i32| {
        let mut chain = parse(&chain_words(&[], &[arpeggiator(0.0, 1.0)]));
        ons(&run(&mut chain, 100, &[(0, 0, on(C)), (93, offset, on(E))], steady))[1]
    };
    assert_eq!(second(100), (EIGHTH, C));
    assert_eq!(second(50), (EIGHTH, E));
}

#[test]
fn stopped_the_arpeggiator_starts_with_the_first_key() {
    let mut chain = parse(&chain_words(&[], &[arpeggiator(0.0, 1.0)]));
    let stopped = |block: u64| BlockTransport { beat: 3.3 + block as f64 * 128.0 * PER_SAMPLE, per_sample: PER_SAMPLE, playing: false };
    let start = 5 * 128 + 40;
    let played = ons(&run(&mut chain, 200, &[(5, 40, on(C))], stopped));
    assert_eq!(played, vec![(start, C), (start + EIGHTH, C), (start + 2 * EIGHTH, C)]);
}

#[test]
fn a_loop_jumping_back_steps_on_without_playing_a_step_twice() {
    // A two-beat loop: four eighths, then back to beat 0, as a host's loop does.
    let mut chain = parse(&chain_words(&[], &[arpeggiator(0.0, 1.0)]));
    let looping = |block: u64| BlockTransport { beat: (block as f64 * 128.0 * PER_SAMPLE) % 2.0, per_sample: PER_SAMPLE, playing: true };
    let played = ons(&run(&mut chain, 1125, &[(0, 0, on(C)), (0, 0, on(E)), (0, 0, on(G))], looping));
    let per_loop: Vec<usize> = (0..3).map(|lap| played.iter().filter(|&&(time, _)| time / 48000 == lap).count()).collect();
    assert_eq!(per_loop, vec![4, 4, 4], "{played:?}");
}

#[test]
fn a_random_field_draws_the_same_numbers_every_time() {
    let words = chain_words(&[], &[device(fixed(0.0), &[node(INPUT, &[], &[]), node(VELOCITY, &[&[0]], &[random(0.0, 1.0)])], 1)]);
    let velocities = || {
        let mut chain = parse(&words);
        let keys: Vec<(u64, i32, Event)> = (0..8).map(|index| (0, index * 10, on(C + index))).collect();
        run(&mut chain, 1, &keys, steady).into_iter().map(|(_, event)| event).collect::<Vec<_>>()
    };
    let first = velocities();
    assert_eq!(first, velocities());
    let distinct: std::collections::HashSet<u32> =
        first.iter().filter_map(|event| if let Event::On { velocity, .. } = event { Some(velocity.to_bits()) } else { None }).collect();
    assert!(distinct.len() > 4, "{first:?}");
}
