//! MIDI devices in the engine (INST-11.1, crate::midi): chains read from words as midi/compile.ts
//! writes them, then played block by block as a track plays them. The octavator and an arpeggiator
//! are built from nodes here; the clock is checked against a transport driven as a host drives it.

use crate::midi::{self, BlockTransport, Chain, Event, Key, pattern};

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
const EUCLID: f64 = 6.0;
const RATCHET: f64 = 7.0;
const ORDER: f64 = 8.0;
const DELAY: f64 = 9.0;
const LENGTH: f64 = 10.0;
const CHANCE: f64 = 11.0;
const CHORD: f64 = 5.0;

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
/// A field reading the note (0 index, 1 pitch, 2 velocity), times one number plus another.
// TS: const per = (read, times, plus) => [3, read, ...fixed(times), ...fixed(plus)]
fn per(read: f64, times: f64, plus: f64) -> Vec<f64> {
    [vec![3.0, read], fixed(times), fixed(plus)].concat()
}
const INDEX: f64 = 0.0;

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
// TS: const device = (bypass, nodes, output) => [...bypass, nodes.length, output, ...nodes.flat()]
fn device(bypass: Vec<f64>, nodes: &[Vec<f64>], output: usize) -> Vec<f64> {
    let mut words = bypass;
    words.extend([nodes.len() as f64, output as f64]);
    nodes.iter().for_each(|node| words.extend(node));
    words
}

/// A chain's words: how many values, the devices, then the values.
// TS: const chainWords = (values, devices) => [values.length, devices.length, ...devices.flat(), ...values]
fn chain_words(values: &[f64], devices: &[Vec<f64>]) -> Vec<f64> {
    let mut words = vec![values.len() as f64, devices.len() as f64];
    devices.iter().for_each(|device| words.extend(device));
    words.extend(values);
    words
}

/// The octavator: copies an octave up and down, each switched by a value, at a level (values 0, 1, 2).
// TS: a copy is [interval, level, on]; device(fixed(0), [input, stack(copies 3: dry, up, down)], 1)
fn octavator() -> Vec<f64> {
    let copy = |interval: f64, on: Vec<f64>| [fixed(interval), bound(2), on];
    let mut fields = vec![fixed(0.0), fixed(1.0), fixed(1.0)];
    fields.extend(copy(12.0, bound(0)));
    fields.extend(copy(-12.0, bound(1)));
    device(fixed(0.0), &[node(INPUT, &[], &[]), node(STACK, &[&[0]], &fields)], 1)
}

/// An arpeggiator: the keys stacked over `octaves`, a clock in eighths synced to the keys, picking
/// through what's held, each note half a step long.
// TS: device(fixed(0), [input, clock(sync: input, beats 0.5), pick(notes: input, ticks: clock, direction, octaves, gate 0.5)], 2)
// TS: device(fixed(0), [input, stack(an octave a copy), clock(sync, 1/8), pick(notes: stack, ticks: clock, direction), length(0.5)], 4)
fn arpeggiator(direction: f64, octaves: f64) -> Vec<f64> {
    let copies: Vec<Vec<f64>> = (0..octaves as usize).flat_map(|octave| [fixed(12.0 * octave as f64), fixed(1.0), fixed(1.0)]).collect();
    device(
        fixed(0.0),
        &[
            node(INPUT, &[], &[]),
            node(STACK, &[&[0]], &copies),
            node(CLOCK, &[&[0]], &[fixed(0.5)]),
            node(PICK, &[&[1], &[2]], &[fixed(direction)]),
            node(LENGTH, &[&[3]], &[fixed(0.5)]),
        ],
        4,
    )
}

// TS: const parse = (words) => { const chain = midi.parse(words); if (!chain) throw new Error("the words make a chain"); return chain }
fn parse(words: &[f64]) -> Chain {
    midi::parse(words).expect("the words make a chain")
}

/// Playing from beat 0 at 120.
// TS: const steady = (block) => ({ beat: block * 128 * PER_SAMPLE, perSample: PER_SAMPLE, playing: true })
fn steady(block: u64) -> BlockTransport {
    BlockTransport { beat: block as f64 * 128.0 * PER_SAMPLE, per_sample: PER_SAMPLE, playing: true, key: Key::C_MAJOR }
}

/// Play `blocks` blocks, telling the chain `keys` (block, offset, event) as they come: every event it
/// sends the voices, as (sample time, event), each note's index set to 0 (the voices don't read it,
/// and these tests compare pitches and times).
// TS: for (let n = 0; n < blocks; n++) { keys at n -> chain.key; chain.block(n * 128, transport(n)).forEach(...) }
fn run(chain: &mut Chain, blocks: u64, keys: &[(u64, i32, Event)], transport: impl Fn(u64) -> BlockTransport) -> Vec<(u64, Event)> {
    let mut played = Vec::new();
    for block in 0..blocks {
        keys.iter().filter(|(at, _, _)| *at == block).for_each(|&(_, offset, event)| chain.key(offset, event));
        let clock = block * 128;
        played.extend(chain.block(clock, transport(block)).iter().map(|&(offset, event)| (clock + offset as u64, unindexed(event))));
    }
    played
}

// TS: event.kind === "tick" ? event : { ...event, index: 0 }
fn unindexed(event: Event) -> Event {
    match event {
        Event::On { note, velocity, length, .. } => Event::On { note, velocity, length, index: 0 },
        Event::Off { note, .. } => Event::Off { note, index: 0 },
        tick => tick,
    }
}

// TS: const on = (note) => ({ kind: "on", note, velocity: 1 }); const off = (note) => ({ kind: "off", note })
fn on(note: i32) -> Event {
    Event::On { note, velocity: 1.0, length: None, index: 0 }
}
fn off(note: i32) -> Event {
    Event::Off { note, index: 0 }
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
    // TS: const velocity = (note) => played.map(([, event]) => event).find((event) => event.kind === "on" && event.note === note)
    // `matches!(value, pattern if condition)` is true when the value fits the pattern.
    let velocity = |note| played.iter().find_map(|&(_, event)| matches!(event, Event::On { note: on, .. } if on == note).then_some(event));
    assert_eq!(ons(&played), vec![(5, C), (5, C + 12)]);
    assert_eq!(velocity(C + 12), Some(Event::On { note: C + 12, velocity: 0.5, length: None, index: 0 }));
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
    // TS: const released = chain.block(128, steady(1)).map(([, event]) => event)
    let released: Vec<Event> = chain.block(128, steady(1)).iter().map(|&(_, event)| unindexed(event)).collect();
    assert_eq!(released, vec![off(C), off(C + 12)]);
}

#[test]
fn devices_chain_in_order_and_each_reads_its_own_fields() {
    let transpose = device(fixed(0.0), &[node(INPUT, &[], &[]), node(TRANSPOSE, &[&[0]], &[fixed(2.0)])], 1);
    let velocity = device(fixed(0.0), &[node(INPUT, &[], &[]), node(VELOCITY, &[&[0]], &[fixed(0.5)])], 1);
    let mut chain = parse(&chain_words(&[1.0, 0.0, 1.0], &[octavator(), transpose, velocity]));
    let played = run(&mut chain, 1, &[(0, 0, Event::On { note: C, velocity: 0.8, length: None, index: 0 })], steady);
    assert_eq!(
        played,
        vec![(0, Event::On { note: C + 2, velocity: 0.4, length: None, index: 0 }), (0, Event::On { note: C + 14, velocity: 0.4, length: None, index: 0 })]
    );
}

#[test]
fn bypassing_a_device_lets_go_of_what_it_moved_then_passes_notes_through() {
    // Value 3 is the device's bypass.
    // TS: const words = octavator(); words.splice(0, 2, ...bound(3))  (its fixed bypass becomes value 3)
    let mut words = octavator();
    words.splice(0..2, bound(3));
    let mut chain = parse(&chain_words(&[1.0, 0.0, 1.0, 0.0], &[words]));
    chain.key(0, on(C));
    chain.block(0, steady(0));
    chain.set_value(3, 1.0);
    chain.key(20, on(E));
    // TS: const played = chain.block(128, steady(1)).map(([offset, event]) => [offset, unindexed(event)])
    let played: Vec<(usize, Event)> = chain.block(128, steady(1)).iter().map(|&(offset, event)| (offset, unindexed(event))).collect();
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
        // TS: return ons(played).map(([, note]) => note).slice(0, 6)
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
    let stopped = |block: u64| BlockTransport { beat: 3.3 + block as f64 * 128.0 * PER_SAMPLE, per_sample: PER_SAMPLE, playing: false, key: Key::C_MAJOR };
    let start = 5 * 128 + 40;
    let played = ons(&run(&mut chain, 200, &[(5, 40, on(C))], stopped));
    assert_eq!(played, vec![(start, C), (start + EIGHTH, C), (start + 2 * EIGHTH, C)]);
}

#[test]
fn a_loop_jumping_back_steps_on_without_playing_a_step_twice() {
    // A two-beat loop: four eighths, then back to beat 0, as a host's loop does.
    let mut chain = parse(&chain_words(&[], &[arpeggiator(0.0, 1.0)]));
    let looping = |block: u64| BlockTransport { beat: (block as f64 * 128.0 * PER_SAMPLE) % 2.0, per_sample: PER_SAMPLE, playing: true, key: Key::C_MAJOR };
    let played = ons(&run(&mut chain, 1125, &[(0, 0, on(C)), (0, 0, on(E)), (0, 0, on(G))], looping));
    // TS: const perLoop = [0, 1, 2].map((lap) => played.filter(([time]) => Math.floor(time / 48000) === lap).length)
    let per_loop: Vec<usize> = (0..3).map(|lap| played.iter().filter(|&&(time, _)| time / 48000 == lap).count()).collect();
    assert_eq!(per_loop, vec![4, 4, 4], "{played:?}");
}

#[test]
fn a_random_field_draws_the_same_numbers_every_time() {
    let words = chain_words(&[], &[device(fixed(0.0), &[node(INPUT, &[], &[]), node(VELOCITY, &[&[0]], &[random(0.0, 1.0)])], 1)]);
    let velocities = || {
        let mut chain = parse(&words);
        // TS: const keys = range(8).map((index) => [0, index * 10, on(C + index)])
        let keys: Vec<(u64, i32, Event)> = (0..8).map(|index| (0, index * 10, on(C + index))).collect();
        run(&mut chain, 1, &keys, steady).into_iter().map(|(_, event)| event).collect::<Vec<_>>()
    };
    let first = velocities();
    assert_eq!(first, velocities());
    // TS: const distinct = new Set(first.flatMap((event) => event.kind === "on" ? [event.velocity] : []))
    // A float can't go in a HashSet (NaN isn't equal to itself), so each goes in as its bits.
    let distinct: std::collections::HashSet<u32> =
        first.iter().filter_map(|event| if let Event::On { velocity, .. } = event { Some(velocity.to_bits()) } else { None }).collect();
    assert!(distinct.len() > 4, "{first:?}");
}

/// A pattern's onsets as x and rests as ., first step first.
// TS: const drawn = ([onsets, steps]) => range(steps).map((step) => (onsets >> step) & 1 ? "x" : ".").join("")
fn drawn((onsets, steps): (u64, usize)) -> String {
    (0..steps).map(|step| if onsets >> step & 1 == 1 { 'x' } else { '.' }).collect()
}

#[test]
fn euclidean_patterns_are_bjorklunds_turned_by_rotate() {
    assert_eq!(drawn(pattern(8.0, 3.0, 0.0)), "x..x..x.");
    assert_eq!(drawn(pattern(8.0, 5.0, 0.0)), "x.xx.xx.");
    assert_eq!(drawn(pattern(16.0, 4.0, 0.0)), "x...x...x...x...");
    // Rotate 1: each step plays what the next did.
    assert_eq!(drawn(pattern(8.0, 3.0, 1.0)), "..x..x.x");
    assert_eq!(drawn(pattern(4.0, 0.0, 0.0)), "....");
    assert_eq!(drawn(pattern(4.0, 9.0, 0.0)), "xxxx");
    assert_eq!(drawn(pattern(64.0, 64.0, 0.0)), "x".repeat(64));
}

/// A Euclidean sequencer: sixteenths through euclid (3 of 8, accent 0.5) and a ratchet, playing the chord.
// TS: device(fixed(0), [input, clock(sync, 1/16), euclid(8, 3, 0, 0.5), ratchet(repeats), pick(notes, ticks, chord), length(0.5)], 5)
fn euclidean(repeats: f64) -> Vec<f64> {
    device(
        fixed(0.0),
        &[
            node(INPUT, &[], &[]),
            node(CLOCK, &[&[0]], &[fixed(0.25)]),
            node(EUCLID, &[&[1]], &[fixed(8.0), fixed(3.0), fixed(0.0), fixed(0.5)]),
            node(RATCHET, &[&[2]], &[fixed(repeats)]),
            node(PICK, &[&[0], &[3]], &[fixed(CHORD)]),
            node(LENGTH, &[&[4]], &[fixed(0.5)]),
        ],
        5,
    )
}

#[test]
fn a_euclidean_plays_the_chord_on_its_onsets_the_first_of_each_cycle_loudest() {
    let sixteenth = EIGHTH / 2;
    let mut chain = parse(&chain_words(&[], &[euclidean(1.0)]));
    let played = run(&mut chain, 400, &[(0, 0, on(C)), (0, 0, on(E))], steady);
    let steps: Vec<(u64, i32)> = [0, 3, 6, 8].iter().flat_map(|&step| [(step * sixteenth, C), (step * sixteenth, E)]).collect();
    assert_eq!(ons(&played), steps);
    // TS: const velocities = played.flatMap(([, event]) => event.kind === "on" ? [event.velocity] : [])
    let velocities: Vec<f32> = played.iter().filter_map(|&(_, event)| if let Event::On { velocity, .. } = event { Some(velocity) } else { None }).collect();
    assert_eq!(velocities, vec![1.0, 1.0, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0]);
}

#[test]
fn a_ratchet_repeats_each_onset_through_its_step_even_past_the_block() {
    let sixteenth = EIGHTH / 2;
    let mut chain = parse(&chain_words(&[], &[euclidean(3.0)]));
    let played = run(&mut chain, 40, &[(0, 0, on(C))], steady);
    // A sixteenth (6000 samples) in thirds, each played for half a third.
    assert_eq!(ons(&played), vec![(0, C), (sixteenth / 3, C), (2 * sixteenth / 3, C)]);
    assert!(played.contains(&(sixteenth / 6, off(C))));
}

/// A strum built from parts: `order` numbers a chord's notes (direction, together within a 32nd),
/// `delay` plays each a 64th (1500 samples here) after the one before, and `velocity` tilts them.
// TS: device(fixed(0), [input, order(direction, 1/32), delay(beats: index x 1/64), velocity(scale: 1 + index x tilt)], 3)
fn strum(direction: f64, tilt: f64) -> Vec<f64> {
    device(
        fixed(0.0),
        &[
            node(INPUT, &[], &[]),
            node(ORDER, &[&[0]], &[fixed(direction), fixed(0.125)]),
            node(DELAY, &[&[1]], &[per(INDEX, 0.0625, 0.0)]),
            node(VELOCITY, &[&[2]], &[per(INDEX, tilt, 1.0)]),
        ],
        3,
    )
}

#[test]
fn a_strum_from_parts_spreads_a_chord_and_its_note_offs_wait_as_long_as_its_ons() {
    let mut chain = parse(&chain_words(&[], &[strum(0.0, 0.0)]));
    let chord = [(0, 10, on(E)), (0, 10, on(G)), (0, 10, on(C)), (156, 32, off(C)), (156, 32, off(E)), (156, 32, off(G))];
    let played = run(&mut chain, 200, &chord, steady);
    assert_eq!(ons(&played), vec![(10, C), (1510, E), (3010, G)]);
    let release = 156 * 128 + 32;
    // TS: const offAt = (note) => played.find(([, event]) => event.kind === "off" && event.note === note)?.[0]
    let off_at = |note: i32| played.iter().find(|&&(_, event)| matches!(event, Event::Off { note: off, .. } if off == note)).map(|&(time, _)| time);
    assert_eq!([off_at(C), off_at(E), off_at(G)], [Some(release), Some(release + 1500), Some(release + 3000)]);
}

#[test]
fn a_strum_from_parts_goes_down_alternates_and_tilts_its_velocity() {
    let notes = |direction: f64, tilt: f64, keys: &[(u64, i32, Event)]| {
        let mut chain = parse(&chain_words(&[], &[strum(direction, tilt)]));
        run(&mut chain, 300, keys, steady)
    };
    let chord = |block: u64| [(block, 0, on(C)), (block, 0, on(E)), (block, 0, on(G))];
    let down = notes(1.0, 0.0, &chord(0));
    assert_eq!(ons(&down).iter().map(|&(_, note)| note).collect::<Vec<_>>(), vec![G, E, C]);
    // Alternate: up, then down for the next chord (well past the window).
    let both: Vec<(u64, i32, Event)> = chord(0).into_iter().chain(chord(100)).collect();
    let alternating = ons(&notes(2.0, 0.0, &both)).iter().map(|&(_, note)| note).collect::<Vec<_>>();
    assert_eq!(alternating, vec![C, E, G, G, E, C]);
    // Tilt -0.25: each note a quarter quieter than full.
    // TS: const velocities = played.flatMap(([, event]) => event.kind === "on" ? [event.velocity] : [])
    let velocities: Vec<f32> = notes(0.0, -0.25, &chord(0)).iter().filter_map(|&(_, event)| if let Event::On { velocity, .. } = event { Some(velocity) } else { None }).collect();
    assert_eq!(velocities, vec![1.0, 0.75, 0.5]);
}

#[test]
fn an_echo_from_parts_repeats_each_note_climbing_and_fading() {
    // A stack makes three copies, each a fifth up from the last and numbered by copy; delay plays copy n
    // an eighth (12000 samples) times n later, and velocity fades each by a third.
    let copy = |interval: f64| [fixed(interval), fixed(1.0), fixed(1.0)];
    let fields: Vec<Vec<f64>> = [copy(0.0), copy(7.0), copy(14.0)].concat();
    let echo = device(
        fixed(0.0),
        &[
            node(INPUT, &[], &[]),
            node(STACK, &[&[0]], &fields),
            node(DELAY, &[&[1]], &[per(INDEX, 0.5, 0.0)]),
            node(VELOCITY, &[&[2]], &[per(INDEX, -1.0 / 3.0, 1.0)]),
        ],
        3,
    );
    let mut chain = parse(&chain_words(&[], &[echo]));
    let played = run(&mut chain, 300, &[(0, 0, on(C)), (10, 0, off(C))], steady);
    assert_eq!(ons(&played), vec![(0, C), (EIGHTH, C + 7), (2 * EIGHTH, C + 14)]);
    // Each copy's note off comes as long after its note on as the key was held.
    assert!(played.contains(&(1280, off(C))) && played.contains(&(EIGHTH + 1280, off(C + 7))) && played.contains(&(2 * EIGHTH + 1280, off(C + 14))));
}

#[test]
fn chance_lets_notes_through_the_same_way_every_time_and_drops_the_offs_of_those_it_dropped() {
    let maybe = device(fixed(0.0), &[node(INPUT, &[], &[]), node(CHANCE, &[&[0]], &[fixed(0.5)])], 1);
    let keys: Vec<(u64, i32, Event)> = (0..16).flat_map(|index| [(index * 2, 0, on(C + index as i32)), (index * 2 + 1, 0, off(C + index as i32))]).collect();
    let played = || {
        let mut chain = parse(&chain_words(&[], &[maybe.clone()]));
        run(&mut chain, 40, &keys, steady)
    };
    let first = played();
    assert_eq!(first, played());
    let kept = ons(&first).len();
    assert!(kept > 2 && kept < 14, "{kept} of 16");
    // As many note offs as note ons: the dropped notes' offs went with them.
    // TS: first.filter(([, event]) => event.kind === "off").length
    assert_eq!(first.iter().filter(|(_, event)| matches!(event, Event::Off { .. })).count(), kept);
}

#[test]
fn a_delay_lets_go_of_what_it_played_when_the_chain_clears() {
    let mut chain = parse(&chain_words(&[], &[strum(0.0, 0.0)]));
    run(&mut chain, 20, &[(0, 0, on(C)), (0, 0, on(E)), (0, 0, on(G))], steady);
    chain.clear();
    // Only C (at 0) and E (at 1500) had played; G was still waiting, and is dropped.
    let after: Vec<Event> = chain.block(20 * 128, steady(20)).iter().map(|&(_, event)| event).collect();
    assert!(!after.contains(&on(G)), "{after:?}");
}
