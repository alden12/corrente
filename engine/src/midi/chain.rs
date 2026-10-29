//! A track's MIDI devices, played a block at a time: the keys it's told go into the first device, each
//! device's output into the next, and the last one's out to the voices, with each note that has a
//! length let go when it runs out.

use super::nodes::{Kind, Node, push};
use super::{BlockTransport, Event, Field, MAX_EVENTS, MAX_HELD, MAX_RELEASES, NoteContext, Timed};
use crate::router::BLOCK;

/// One device: its nodes in order (each after what it reads), each node's output this block, and room
/// to merge a node's inputs.
// TS: class Device { nodes: Node[]; output: number; bypass: Field; seed: bigint; ... }
pub struct Device {
    pub nodes: Vec<Node>,
    /// The node whose output is the device's.
    pub output: usize,
    /// On (0.5 and over): the device passes its notes through as they are.
    pub bypass: Field,
    pub seed: u64,
    bypassed: bool,
    outputs: Vec<Vec<Timed>>,
    /// One merged list per port of the node playing now (no kind has more than two).
    merged: [Vec<Timed>; 2],
    /// The device's output this block.
    result: Vec<Timed>,
}

impl Device {
    // TS: new Device(nodes, output, bypass, seed), each list made with room for a block
    pub fn new(nodes: Vec<Node>, output: usize, bypass: Field, seed: u64) -> Self {
        let room = || Vec::with_capacity(MAX_EVENTS);
        let outputs = nodes.iter().map(|_| room()).collect();
        Device { nodes, output, bypass, seed, bypassed: false, outputs, merged: [room(), room()], result: room() }
    }

    /// The device's output for a block given `input`. Turning bypass on or off lets go of what the
    /// device was holding, so no note it moved is left sounding.
    // TS: process(input, values, transport): Timed[]
    fn process(&mut self, input: &[Timed], values: &[f64], transport: BlockTransport) -> &[Timed] {
        self.result.clear();
        let bypassed = self.bypass.read(values, || 0.0, NoteContext::default()) >= 0.5;
        if bypassed != self.bypassed {
            self.bypassed = bypassed;
            self.nodes.iter_mut().for_each(|node| node.clear(0, &mut self.result));
        }
        if bypassed {
            input.iter().for_each(|&(offset, event)| push(&mut self.result, offset, event));
            return &self.result;
        }
        // `let Device { a, b, .. } = self` lends each field on its own, so a node can write its output
        // while the merged lists and the other nodes' outputs are read.
        let Device { nodes, outputs, merged, seed, output, result, .. } = self;
        for (index, node) in nodes.iter_mut().enumerate() {
            // TS: inputs = node.ports.map((sources) => merge(sources.map((source) => outputs[source])))
            // Every source comes before `index`, so the outputs split there: read before, write at.
            let (before, rest) = outputs.split_at_mut(index);
            let out = &mut rest[0];
            out.clear();
            if matches!(node.kind, Kind::Input) {
                input.iter().for_each(|&(offset, event)| push(out, offset, event));
                continue;
            }
            for (port, sources) in node.ports.iter().enumerate() {
                merge(&mut merged[port], sources.iter().map(|&source| before[source].as_slice()));
            }
            let context = super::nodes::Context { values, transport, seed: *seed, node: index };
            node.process(&merged[..node.ports.len()], &context, out);
        }
        // TS: result.push(...outputs[output])  (after any note offs from a bypass turned off)
        outputs[*output].iter().for_each(|&(offset, event)| push(result, offset, event));
        result
    }

    // TS: this.nodes.forEach((node) => node.clear(0, []))
    fn clear(&mut self) {
        self.nodes.iter_mut().for_each(|node| node.clear(0, &mut self.result));
        self.result.clear();
    }
}

/// Put `lists` (each in offset order) into `into` in offset order, earlier lists first at a tie.
// TS: into.splice(0, into.length, ...lists.flat().sort stably by offset)
// Inserting keeps the order without a sort that would allocate: the lists are short.
fn merge<'a>(into: &mut Vec<Timed>, lists: impl Iterator<Item = &'a [Timed]>) {
    into.clear();
    for list in lists {
        for &(offset, event) in list {
            if into.len() == MAX_EVENTS {
                return;
            }
            let at = into.iter().rposition(|&(other, _)| other <= offset).map_or(0, |at| at + 1);
            into.insert(at, (offset, event));
        }
    }
}

/// A track's chain of MIDI devices, and the values their fields read.
// TS: class Chain { devices: Device[]; values: number[]; ... }
pub struct Chain {
    pub devices: Vec<Device>,
    pub values: Vec<f64>,
    /// The keys told this block, in offset order.
    incoming: Vec<Timed>,
    /// The keys down now, to play into a chain that replaces this one.
    down: Vec<(i32, f32)>,
    /// Notes with a length that are sounding: when each is let go (on the track's clock), and which.
    releases: Vec<(u64, i32)>,
    /// What passes from one device to the next, and what goes to the voices.
    between: Vec<Timed>,
    out: Vec<Timed>,
}

impl Chain {
    // TS: new Chain(devices, values), each list made with room
    pub fn new(devices: Vec<Device>, values: Vec<f64>) -> Self {
        Chain {
            devices,
            values,
            incoming: Vec::with_capacity(MAX_EVENTS),
            down: Vec::with_capacity(MAX_HELD),
            releases: Vec::with_capacity(MAX_RELEASES),
            between: Vec::with_capacity(MAX_EVENTS),
            out: Vec::with_capacity(MAX_EVENTS * 2),
        }
    }

    /// A key down or up, `offset` samples into the coming block: kept in offset order, after any at
    /// the same offset.
    // TS: insert [offset, event] after the last at or before offset; note the key in `down`
    pub fn key(&mut self, offset: i32, event: Event) {
        let offset = usize::try_from(offset).unwrap_or(0).min(BLOCK - 1);
        match event {
            Event::On { note, velocity, .. } if self.down.len() < MAX_HELD && !self.down.iter().any(|&(down, _)| down == note) => {
                self.down.push((note, velocity));
            }
            Event::Off { note, .. } => self.down.retain(|&(down, _)| down != note),
            _ => {}
        }
        if self.incoming.len() < MAX_EVENTS {
            let at = self.incoming.iter().rposition(|&(other, _)| other <= offset).map_or(0, |at| at + 1);
            self.incoming.insert(at, (offset, event));
        }
    }

    /// The keys down now, with their velocities.
    // TS: down(): readonly [note: number, velocity: number][] { return this.down }
    pub fn down(&self) -> &[(i32, f32)] {
        &self.down
    }

    /// Move a value to `raw`. A value the chain doesn't have is ignored.
    // TS: if (value < this.values.length) this.values[value] = raw
    pub fn set_value(&mut self, value: usize, raw: f64) {
        if let Some(slot) = self.values.get_mut(value) {
            *slot = raw;
        }
    }

    /// Let go of everything: the keys, what every device holds, and the notes waiting to be let go
    /// (the track lets go of its voices itself).
    // TS: this.incoming = []; this.down = []; this.releases = []; this.devices.forEach((device) => device.clear())
    pub fn clear(&mut self) {
        self.incoming.clear();
        self.down.clear();
        self.releases.clear();
        self.devices.iter_mut().for_each(Device::clear);
    }

    /// What the voices play in the block starting at `clock` (on the track's clock): note ons and offs
    /// in sample order. A note with a length starts here and is let go here too, when it runs out.
    // TS: block(clock, transport): Timed[]
    pub fn block(&mut self, clock: u64, transport: BlockTransport) -> &[Timed] {
        // TS: let between = this.incoming; for (const device of this.devices) between = device.process(between, ...)
        let Chain { devices, values, incoming, between, out, releases, .. } = self;
        between.clear();
        between.extend_from_slice(incoming);
        incoming.clear();
        for device in devices.iter_mut() {
            let output = device.process(between, values, transport);
            between.clear();
            between.extend_from_slice(output);
        }
        // TS:
        //   for (const [offset, event] of between) { out.push(...releases due by clock + offset); out.push(event); if (event.length) releases.push([clock + offset + length, note]) }
        //   out.push(...releases due before the block ends)
        out.clear();
        for &(offset, event) in between.iter() {
            release_until(releases, out, clock, clock + offset as u64 + 1);
            match event {
                Event::On { note, velocity, length, index } => {
                    push_out(out, offset, Event::On { note, velocity, length: None, index });
                    if let Some(length) = length.filter(|_| releases.len() < MAX_RELEASES) {
                        releases.push((clock + offset as u64 + u64::from(length), note));
                    }
                }
                Event::Off { .. } => push_out(out, offset, event),
                Event::Tick { .. } => {}
            }
        }
        release_until(releases, out, clock, clock + BLOCK as u64);
        out
    }
}

/// Note offs for every note due to be let go before `until`, earliest first.
// TS: while (releases has one due before `until`) { take the earliest; out.push([time - clock, off(note)]) }
fn release_until(releases: &mut Vec<(u64, i32)>, out: &mut Vec<Timed>, clock: u64, until: u64) {
    // Each turn removes one release, so it ends.
    while let Some(at) = releases.iter().enumerate().filter(|(_, (time, _))| *time < until).min_by_key(|(_, (time, _))| *time).map(|(at, _)| at) {
        let (time, note) = releases.swap_remove(at);
        push_out(out, time.saturating_sub(clock) as usize, Event::Off { note, index: 0 });
    }
}

// TS: if (out.length < MAX_EVENTS * 2) out.push([offset, event])
fn push_out(out: &mut Vec<Timed>, offset: usize, event: Event) {
    if out.len() < out.capacity() {
        out.push((offset.min(BLOCK - 1), event));
    }
}
