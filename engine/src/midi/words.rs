//! Reading a chain from `eng_midi_load`'s words (midi/compile.ts writes them): f64s, each sent as two
//! int32 words (low half first), as `eng_bind`'s are.
//!
//!   values, devices,
//!   each device: its bypass (a field), nodes, the output node,
//!     each node: kind, ports, each port: sources, each source's node; fields, each field,
//!   each value's raw value.
//!
//! A field is 0 then a number, 1 then a value and its shaping (scale, offset, points, each point's
//! input and output), or 2 then the least and most of a random number.
//!
//! Everything is checked before it plays: a kind the engine knows, the ports and fields it takes, each
//! source an earlier node with the right output for its port, an output that is notes. A chain the
//! words don't make is refused (None), and the track keeps the one it had.

use super::chain::{Chain, Device};
use super::nodes::{Fields, Kind, Node, SPECS, Wire};
use super::{Field, MAX_COPIES};
use crate::router::Shaping;

/// The seed a device's random fields start from, by its place in the chain.
// TS: const seedOf = (device: number) => 0x5EED_0000 + device
fn seed_of(device: usize) -> u64 {
    0x5EED_0000 + device as u64
}

/// Read a chain, or None if the words don't make one.
// TS: parse(words): Chain | undefined
pub fn parse(words: &[f64]) -> Option<Chain> {
    let mut reader = Reader { words, at: 0, values: 0 };
    reader.values = reader.count()?;
    let device_count = reader.count()?;
    // TS: const devices = Array.from({ length: deviceCount }, (_, index) => reader.device(index))  (undefined if any is)
    let devices = (0..device_count).map(|index| reader.device(index)).collect::<Option<Vec<_>>>()?;
    let values = (0..reader.values).map(|_| reader.word()).collect::<Option<Vec<_>>>()?;
    (reader.at == words.len()).then(|| Chain::new(devices, values))
}

/// Reads the words in turn. Each method gives None once they run out or don't fit.
// TS: a cursor over a Float64Array, as binding.rs's Reader.
struct Reader<'a> {
    words: &'a [f64],
    at: usize,
    values: usize,
}

impl Reader<'_> {
    // TS: return this.words[this.at++]  (undefined past the end)
    fn word(&mut self) -> Option<f64> {
        let word = *self.words.get(self.at)?;
        self.at += 1;
        Some(word)
    }

    /// A whole number from 0, and not absurdly big.
    // TS: Number.isInteger(word) && word >= 0 && word <= 1e6 ? word : undefined
    fn count(&mut self) -> Option<usize> {
        let word = self.word()?;
        (word.fract() == 0.0 && (0.0..=1e6).contains(&word)).then_some(word as usize)
    }

    // TS: const kind = this.word(); kind === 0 ? fixed : kind === 1 ? bound : kind === 2 ? random : undefined
    fn field(&mut self) -> Option<Field> {
        match self.count()? {
            0 => Some(Field::Fixed(self.word()?)),
            1 => {
                let value = self.count().filter(|&value| value < self.values)?;
                let (scale, offset) = (self.word()?, self.word()?);
                let points = self.count()?;
                let table = (0..points).map(|_| Some((self.word()?, self.word()?))).collect::<Option<Vec<_>>>()?;
                Some(Field::Bound(value, Shaping::new(scale, offset, table)))
            }
            2 => Some(Field::Random(self.word()?, self.word()?)),
            _ => None,
        }
    }

    /// A device: its nodes checked against each other, and its output.
    // TS: device(index): Device | undefined  (each read below gives up with undefined if the words run out)
    fn device(&mut self, index: usize) -> Option<Device> {
        let bypass = self.field()?;
        let node_count = self.count()?;
        let output = self.count()?;
        // TS: const nodes = []; for (let at = 0; at < nodeCount; at++) nodes.push(this.node(at, nodes))
        let mut outputs: Vec<Wire> = Vec::with_capacity(node_count);
        let mut nodes = Vec::with_capacity(node_count);
        for at in 0..node_count {
            let (node, wire) = self.node(at, &outputs)?;
            nodes.push(node);
            outputs.push(wire);
        }
        (outputs.get(output) == Some(&Wire::Notes)).then(|| Device::new(nodes, output, bypass, seed_of(index)))
    }

    /// Node `at`, given what each earlier node outputs: the node and what it outputs.
    // TS: const spec = SPECS[kind]; check its ports' sources and its field count against it
    fn node(&mut self, at: usize, earlier: &[Wire]) -> Option<(Node, Wire)> {
        let kind_number = self.count()?;
        let spec = SPECS.get(kind_number)?;
        let kind = Kind::new(kind_number)?;
        if self.count()? != spec.ports.len() {
            return None;
        }
        // Each port's sources: earlier nodes (so the order runs) whose output is what the port takes.
        let ports = spec
            .ports
            .iter()
            .map(|&wire| {
                let sources = self.count()?;
                (0..sources).map(|_| self.count().filter(|&source| source < at && earlier.get(source) == Some(&wire))).collect::<Option<Vec<_>>>()
            })
            .collect::<Option<Vec<_>>>()?;
        let field_count = self.count()?;
        let fits = match spec.fields {
            Fields::Exactly(count) => field_count == count,
            Fields::Copies => field_count % 3 == 0 && field_count / 3 <= MAX_COPIES,
        };
        if !fits {
            return None;
        }
        let fields = (0..field_count).map(|_| self.field()).collect::<Option<Vec<_>>>()?;
        Some((Node { kind, ports, fields }, spec.output))
    }
}
