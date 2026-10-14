/**
 * The definition format, described for whoever writes one (an agent, through the MCP's
 * `describe_device_format`, from INST-36.8). Generated from the format's constants and the block
 * catalogue, so a new block or signal is described the moment it exists; the tests check every
 * signal has words here and that the example compiles.
 */
import { CATALOGUE, type Port } from "./catalogue";
import { DEVICE_CAP, blockShare, percent, voiceShare } from "./cost";
import {
  DEFAULT_VOICES,
  DEFINITION_FORMAT,
  HOST_SIGNALS,
  MAX_VOICES,
  RESERVED_NAMES,
  SYNC_UNITS,
  TRACK_INPUTS,
  VOICE_SIGNALS,
  VOICE_SUM,
  type DeviceDefinition,
} from "./format";

/** What each signal is, by name. */
export const SIGNAL_MEANINGS: Record<
  keyof typeof VOICE_SIGNALS | keyof typeof VOICE_SUM | keyof typeof TRACK_INPUTS | keyof typeof HOST_SIGNALS,
  string
> = {
  "voice.frequency": "the note's frequency in Hz",
  "voice.gate": "1 while the note is held, 0 once it's let go: feed an envelope's gate",
  "voice.velocity": "how hard the note was played, 0 to 1 (the engine already scales each voice by it)",
  "voice.note": "the MIDI note number, 60 is middle C: for key tracking",
  "voice.seed": "a random number from 0 to 1 drawn at each note on: for drift and variation between notes",
  "voice.sample": "the sample of the zone the note took: wire it to a sampler's sample (with zones only)",
  "voice.root": "the root note of the zone the note took: wire it to a sampler's root (with zones only)",
  "voice.start": "where in its sample the zone the note took starts, 0 to 1 (with zones only)",
  "voice.end": "where in its sample the zone the note took ends, 0 to 1 (with zones only)",
  "voices.left": "every voice summed, left (after the voices only)",
  "voices.right": "every voice summed, right (after the voices only)",
  "input.left": "the track's audio in, left: what an effect processes",
  "input.right": "the track's audio in, right",
  "input.sidechainLeft": "the sidechain in, left: a compressor's key, a vocoder's carrier",
  "input.sidechainRight": "the sidechain in, right",
  "host.tempo": "the project's tempo in beats a minute",
  "host.beat": "the beat, counted from where the transport started; runs on while stopped",
  "host.playing": "1 while the transport plays, 0 while stopped",
  "host.beatSeconds": "a beat's length in seconds",
  "host.beatSamples": "a beat's length in samples",
};

const portOf = (port: Port & { init?: number }) => ({
  name: port.name,
  range: [port.min, port.max],
  ...(port.unit ? { unit: port.unit } : {}),
  ...(port.init !== undefined ? { default: port.init } : {}),
});

/** A small definition using most of the format, which the tests compile. */
export const EXAMPLE: DeviceDefinition = {
  format: DEFINITION_FORMAT,
  voices: 8,
  nodes: {
    lfo: { block: "lfo", inputs: { rate: { beats: "1/4", as: "hz" } } },
    osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
    envelope: {
      block: "adsr",
      voice: true,
      inputs: { gate: "voice.gate", attack: 0.005, release: { param: "release", scale: 0.001 } },
    },
    cutoff: {
      block: "pitch",
      voice: true,
      inputs: { frequency: { param: "cutoff" }, semitones: { from: "lfo.sine", scale: 12 } },
    },
    filter: { block: "svf", voice: true, inputs: { signal: "osc", cutoff: "cutoff", q: 2 } },
    amp: { block: "mul", voice: true, inputs: { a: "filter.lowpass", b: "envelope" } },
    verb: { block: "reverb", inputs: { left: "voices.left", right: "voices.right", mix: 0.2 } },
  },
  voice: "amp",
  output: ["verb.left", "verb.right"],
};

export const definitionFormatDoc = () => ({
  overview:
    `A device is { format: ${DEFINITION_FORMAT}, voices?, latency?, nodes, voice?, output? }. Each node is a block ` +
    "from `blocks` below, wired by name. A node with `voice: true` runs once per sounding voice; the others " +
    "run once for the track, before the voices if they don't hear them (an LFO every voice shares), after if " +
    "they do (effects on the voices summed). `voice` names what each voice plays (one output, or [left, right]); " +
    "`output` what the track plays, the voices summed unless it says. A device with no voice nodes is an effect: " +
    "read `input.left` and `input.right`.",
  zones:
    "zones?: [{ sample: { param }, root, keys?: [low, high], velocities?: [low, high], start?, end? }, ...] maps " +
    "notes to samples: each zone a sample param, the note it plays at its own pitch, the keys (MIDI, both ends " +
    "included) and velocities (0 to 1) it answers, and the part of the sample (fractions). A note takes the first " +
    "zone that fits (none: it doesn't sound), and its voice reads it as voice.sample, voice.root, voice.start and " +
    'voice.end: wire those to a sampler. A drum kit is a zone per pad, root on its own key: { "sample": { "param": ' +
    '"kick" }, "root": 36, "keys": [36, 36] }.',
  voices: `Up to ${MAX_VOICES}; ${DEFAULT_VOICES} if a device with voice nodes doesn't say. Past them, the voice released longest ago fades out for a new note.`,
  inputs: {
    number: "A literal, checked against the input's range.",
    param:
      "{ param, table?, scale?, offset? }: the device's param read as a number (a switch is 0 or 1, a choice its " +
      "option's index from 0), looked up in `table` ([[in, out], ...] ascending, straight lines between) if given, " +
      "then times scale plus offset.",
    reference: "A node (`osc`, its first output), one of its outputs (`svf.highpass`), or a signal (below).",
    scaled:
      "{ from: reference, scale?, offset? }: a reference times scale plus offset, each a number or a param. E.g. " +
      '{ "from": "lfo.sine", "scale": { "param": "depth" } } to sweep by a knob.',
    synced:
      `{ beats, as: ${SYNC_UNITS.join(" | ")} }: a length in beats kept in time with the tempo, as a rate (one ` +
      'cycle per length) or a length. `beats` is a note division ("1/4", "1/8T" triplet, "1/8." dotted, "2/1" ' +
      "two bars of 4/4), a number of beats, or a param: a choice whose options are divisions, or (not as hz) a number.",
    sample:
      "A sampler's `sample` takes a sample param, as { param } alone: whichever sample the param names, built in " +
      "or imported, is loaded for it. A sample param feeds nothing else.",
    list: "Several of the above in a list are summed.",
    unwired: "Every audio input must be wired. A control left out keeps its default.",
  },
  signals: SIGNAL_MEANINGS,
  feedback:
    "Loops are allowed. A loop through a `delay` whose length comes from outside the loop runs in chunks; any " +
    "other loop runs a sample at a time (one sample of delay round it, and much dearer).",
  reserved: `Node names are a letter then letters, digits and _, and can't be ${RESERVED_NAMES.join(", ")}.`,
  cost:
    `A device may take ${percent(DEVICE_CAP)} of a phone's audio thread with every voice sounding, or it's ` +
    `refused. Each block below gives its share, run once; a voice adds ${percent(voiceShare())} of its own, and ` +
    "a block in a sample-at-a-time loop costs many times more.",
  blocks: CATALOGUE.blocks.map((block) => ({
    name: block.name,
    description: block.description,
    inputs: block.inputs.map(portOf),
    controls: block.controls.map(portOf),
    outputs: block.outputs.map(portOf),
    cost: percent(blockShare(block.name)),
  })),
  example: EXAMPLE,
});
