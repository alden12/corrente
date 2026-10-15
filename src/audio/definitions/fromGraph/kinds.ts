/**
 * Each old graph node kind as engine blocks (INST-36.8): one converter per kind, keyed by kind so a
 * kind left out is a compile error. A converter adds the node's blocks through its `KindContext`
 * and says what it outputs, a reference per channel.
 *
 * Web Audio semantics carried over: a param's own value plus whatever is connected into it, summed;
 * an oscillator following the note unless it has an absolute frequency; times in seconds (delays) or
 * milliseconds (envelopes) where the engine takes samples or seconds; detune in cents.
 */
import type { EnumField, FilterKind, NodeSpec, NumberField } from "../../graph/types";
import { FILTER_KINDS, SHAPER_SHAPES } from "../../graph/types";
import type { ParamSpec } from "../../params/types";
import { wavetableRef } from "../../samples/catalog";
import type { InputValue } from "../format";
import { noteFrequency, scaled, scaledRef, summed, valueOf, type SingleInput } from "./fields";

/** What a kind's converter can do while converting one node. */
export interface KindContext {
  /** The node's name in the definition. */
  name: string;
  /** Whether it runs once per voice. */
  voice: boolean;
  /** The channels its audio comes in on: a processor runs a copy per channel. */
  channels: 1 | 2;
  /** The name of its copy for `channel`: the name itself when it is mono. */
  copy(channel: number): string;
  /** What is connected to its audio input on `channel`, summed (0 if nothing is). */
  audioIn(channel: number): InputValue;
  /** What is connected into its `param` (on `channel`), as references. */
  modulators(param: string, channel?: number): string[];
  /** A fresh name for a helper node of its own. */
  helper(suffix: string): string;
  add(name: string, block: string, inputs: Record<string, InputValue>): void;
  /** Something that sounds different from before, for the person whose device it is. */
  note(message: string): void;
  /** Add a param to the device (a sample the old node named directly), returning its id. */
  addParam(spec: ParamSpec): string;
  /** An enum param's options: a choice binds as its option's index. */
  options(param: string): readonly string[];
}

/** How a kind's outputs relate to its inputs' channels. */
type Channels =
  /** Makes sound from nothing: one output. */
  | "source"
  /** A copy per channel coming in. */
  | "copies"
  /** Always left and right out. */
  | "stereo";

interface KindConverter<Spec extends NodeSpec> {
  channels: Channels;
  /** Its outputs by channel, given its name and how many channels it runs on. */
  outputs?: (name: string, copy: (channel: number) => string, channels: 1 | 2) => string[];
  convert(spec: Spec, context: KindContext): void;
}

type Converters = { [Kind in NodeSpec["kind"]]: KindConverter<Extract<NodeSpec, { kind: Kind }>> };

const CENTS_TO_SEMITONES = 0.01;
/** Web Audio's createDelay default: a second. */
const DEFAULT_MAX_DELAY = 1;
/** Ring sizes are samples, set before the sample rate is known: enough for 96 kHz. */
const SIZE_RATE = 96000;
const LARGEST_RING = 2097150;

/** A frequency moved by `detune` cents and whatever modulates detune: a `pitch` node when either is there. */
const detuned = (
  context: KindContext,
  frequency: InputValue,
  detune: NumberField | undefined,
  modulators: string[],
): InputValue => {
  if ((detune === undefined || detune === 0) && modulators.length === 0) return frequency;
  const pitch = context.helper("pitch");
  context.add(pitch, "pitch", {
    frequency,
    semitones: summed([
      valueOf(detune, 0, CENTS_TO_SEMITONES),
      ...modulators.map((from) => scaledRef(from, CENTS_TO_SEMITONES)),
    ]),
  });
  return pitch;
};

type Oscillator = Extract<NodeSpec, { kind: "osc" | "analogOsc" | "wavetableOsc" }>;

/** An oscillator's frequency: absolute Hz if it says, else the note (440 Hz outside a voice) times its ratio. */
const oscillatorFrequency = (spec: Oscillator, context: KindContext): InputValue => {
  const note: SingleInput =
    spec.noteRatio === undefined
      ? context.voice
        ? "voice.frequency"
        : 440
      : context.voice
        ? { from: "voice.frequency", scale: scaled(spec.noteRatio, 1) }
        : scaled(spec.noteRatio, 440);
  const base = spec.frequency === undefined ? note : scaled(spec.frequency, 1);
  return detuned(
    context,
    summed([base, ...context.modulators("frequency")]),
    spec.detune,
    context.modulators("detune"),
  );
};

/** A block for a waveform, given the frequency it plays at. */
type Waveforms = Record<string, (frequency: InputValue) => [block: string, inputs: Record<string, InputValue>]>;

/**
 * An oscillator of the waveform `field` names: that block, or for a waveform chosen by a param, one of
 * each choice and a `select` between them by the param.
 */
const waveformNode = (
  context: KindContext,
  field: EnumField<string> | undefined,
  fallback: string,
  waveforms: Waveforms,
  frequency: InputValue,
) => {
  const make = (waveform: string) => (waveforms[waveform] ?? waveforms[fallback])(frequency);
  if (field === undefined || typeof field === "string") {
    const [block, inputs] = make(field ?? fallback);
    context.add(context.name, block, inputs);
    return;
  }
  const options = context.options(field.param);
  if (options.length > 4) context.note(`${field.param} offers more than four waveforms; the rest play the first`);
  const choices = options.slice(0, 4).map((option) => {
    const name = context.helper(option);
    const [block, inputs] = make(option);
    context.add(name, block, inputs);
    return name;
  });
  const [a, b = a, c = a, d = a] = choices;
  context.add(context.name, "select", { index: { param: field.param }, a, b, c, d });
};

/** Each copy of a per-channel processor: `inputsFor` the channel's inputs, its signal included. */
const perChannel = (
  context: KindContext,
  block: string,
  inputsFor: (signal: InputValue) => Record<string, InputValue>,
) =>
  Array.from({ length: context.channels }, (_, channel) =>
    context.add(context.copy(channel), block, inputsFor(context.audioIn(channel))),
  );

/** Left and right of a stereo block's input: a mono source feeds both. */
const stereoIn = (context: KindContext): [InputValue, InputValue] => [
  context.audioIn(0),
  context.audioIn(context.channels - 1),
];

const stereoOutputs = (name: string) => [`${name}.left`, `${name}.right`];

const OSC_WAVEFORMS: Waveforms = {
  sine: (frequency) => ["sine", { frequency }],
  sawtooth: (frequency) => ["saw", { frequency }],
  square: (frequency) => ["pulse", { frequency, width: 0.5 }],
  triangle: (frequency) => ["triangle", { frequency }],
};

/** A choice of filter type as the biquad block numbers it, in Web Audio's order. */
const filterIndex = (kind: string) => Math.max(0, FILTER_KINDS.indexOf(kind as FilterKind));

/** Envelope fields are milliseconds; the adsr block takes seconds. */
const MS = 0.001;

export const KINDS: Converters = {
  osc: {
    channels: "source",
    convert: (spec, context) =>
      waveformNode(context, spec.waveform, "sine", OSC_WAVEFORMS, oscillatorFrequency(spec, context)),
  },
  analogOsc: {
    channels: "source",
    convert: (spec, context) => {
      const width = summed([valueOf(spec.pulseWidth, 0.5), ...context.modulators("pulseWidth")]);
      waveformNode(
        context,
        spec.waveform,
        "saw",
        {
          saw: (frequency) => ["saw", { frequency }],
          pulse: (frequency) => ["pulse", { frequency, width }],
        },
        oscillatorFrequency(spec, context),
      );
    },
  },
  wavetableOsc: {
    channels: "source",
    convert: (spec, context) => {
      // The old banks are the built-in wavetables. One chosen by a param becomes a wavetable param of
      // its own, starting at that param's default bank: the engine reads a table from a sample.
      const bank =
        spec.bank === undefined || typeof spec.bank === "string"
          ? (spec.bank ?? "classic")
          : (context.options(spec.bank.param)[0] ?? "classic");
      if (spec.bank !== undefined && typeof spec.bank !== "string") {
        context.note(`${spec.bank.param} picked a bank; it is now a wavetable picker (${context.name}.table)`);
      }
      const table = context.addParam({
        id: `${context.name}.table`,
        label: "Wavetable",
        kind: "sample",
        default: wavetableRef(bank),
        wavetable: true,
      });
      context.add(context.name, "wavetable", {
        frequency: oscillatorFrequency(spec, context),
        position: summed([valueOf(spec.position, 0), ...context.modulators("position")]),
        table: { param: table },
      });
    },
  },
  gain: {
    channels: "copies",
    convert: (spec, context) =>
      perChannel(context, "mul", (signal) => ({
        a: signal,
        b: summed([valueOf(spec.gain, 1), ...context.modulators("gain")]),
      })),
  },
  biquad: {
    channels: "copies",
    convert: (spec, context) => {
      // The old format fixes a filter's type: it can't be bound to a param.
      const type = filterIndex(spec.filterType ?? "lowpass");
      const frequency = detuned(
        context,
        summed([valueOf(spec.frequency, 350), ...context.modulators("frequency")]),
        undefined,
        context.modulators("detune"),
      );
      perChannel(context, "biquad", (signal) => ({
        signal,
        type,
        frequency,
        q: summed([valueOf(spec.q, 1), ...context.modulators("q")]),
        gain: summed([valueOf(spec.gain, 0), ...context.modulators("gain")]),
      }));
    },
  },
  delay: {
    channels: "copies",
    convert: (spec, context) => {
      // Seconds into samples: the time scales the sample rate, and each modulator is multiplied by it.
      const time = valueOf(spec.delayTime, 0);
      const modulators = context.modulators("delayTime").map((from) => {
        const name = context.helper("time");
        context.add(name, "mul", { a: from, b: "host.sampleRate" });
        return name;
      });
      const size = Math.min(LARGEST_RING, Math.ceil((spec.maxSeconds ?? DEFAULT_MAX_DELAY) * SIZE_RATE));
      perChannel(context, "delay", (signal) => ({
        signal,
        length: summed([{ from: "host.sampleRate", scale: time }, ...modulators]),
        size,
      }));
    },
  },
  shaper: {
    channels: "copies",
    convert: (spec, context) =>
      perChannel(context, "waveshaper", (signal) => ({
        signal,
        shape: Math.max(0, SHAPER_SHAPES.indexOf(spec.curve.shape)),
        amount: scaled(spec.curve.amount, 1),
      })),
  },
  env: {
    channels: "source",
    convert: (spec, context) =>
      context.add(context.name, "adsr", {
        gate: context.voice ? "voice.gate" : 0,
        attack: valueOf(spec.attack, 5, MS),
        decay: valueOf(spec.decay, 200, MS),
        sustain: valueOf(spec.sustain, 1),
        release: valueOf(spec.release, 200, MS),
      }),
  },
  noise: {
    channels: "source",
    convert: (spec, context) => context.add(context.name, spec.color === "pink" ? "pinknoise" : "noise", {}),
  },
  constant: {
    channels: "source",
    // Web Audio's ConstantSourceNode starts at 1.
    convert: (spec, context) =>
      context.add(context.name, "add", { a: summed([valueOf(spec.offset, 1), ...context.modulators("offset")]), b: 0 }),
  },
  pan: {
    channels: "stereo",
    outputs: stereoOutputs,
    convert: (spec, context) => {
      // The pan block places a mono signal; a stereo one is folded to mono first.
      const signal =
        context.channels === 1
          ? context.audioIn(0)
          : summed([0, 1].flatMap((channel) => halved(context.audioIn(channel))));
      context.add(context.name, "pan", { signal, pan: summed([valueOf(spec.pan, 0), ...context.modulators("pan")]) });
    },
  },
  compressor: {
    channels: "stereo",
    outputs: stereoOutputs,
    convert: (spec, context) => {
      const [left, right] = stereoIn(context);
      if (spec.knee !== undefined) context.note(`${context.name}'s knee is gone: the compressor is hard-kneed`);
      context.add(context.name, "keyedcompressor", {
        left,
        right,
        keyLeft: left,
        keyRight: right,
        threshold: summed([valueOf(spec.threshold, -24), ...context.modulators("threshold")]),
        ratio: summed([valueOf(spec.ratio, 12), ...context.modulators("ratio")]),
        attack: summed([valueOf(spec.attack, 0.003), ...context.modulators("attack")]),
        release: summed([valueOf(spec.release, 0.25), ...context.modulators("release")]),
        makeup: webAudioMakeup(spec.threshold, spec.ratio),
      });
    },
  },
  convolver: {
    channels: "stereo",
    outputs: stereoOutputs,
    convert: (spec, context) => {
      const [left, right] = stereoIn(context);
      context.note(`${context.name} was a convolution reverb; it is now the engine's algorithmic reverb`);
      // The old impulse was noise fading as (1 - t)^2.5 over its length, 60 dB down about 0.9 of the way.
      context.add(context.name, "reverb", {
        left,
        right,
        predelay: 0,
        decay: scaled(spec.impulse.seconds, 0.9),
        mix: 1,
      });
    },
  },
  buffer: {
    channels: "stereo",
    outputs: (name) => [`${name}_l`, `${name}_r`],
    convert: (spec, context) => convertBuffer(spec, context),
  },
  ladder: {
    channels: "copies",
    convert: (spec, context) => {
      const cutoff = detuned(
        context,
        summed([valueOf(spec.frequency, 1000), ...context.modulators("frequency")]),
        spec.detune,
        context.modulators("detune"),
      );
      perChannel(context, "ladder", (signal) => ({
        signal,
        cutoff,
        resonance: summed([valueOf(spec.resonance, 0), ...context.modulators("resonance")]),
      }));
    },
  },
  bitcrush: {
    channels: "copies",
    convert: (spec, context) =>
      perChannel(context, "bitcrush", (signal) => ({
        signal,
        bits: summed([valueOf(spec.bits, 8), ...context.modulators("bits")]),
        downsample: summed([valueOf(spec.downsample, 4), ...context.modulators("downsample")]),
      })),
  },
};

/** Half of each input: a stereo pair folded to mono. */
const halved = (input: InputValue): SingleInput[] =>
  (Array.isArray(input) ? input : [input]).map((each) =>
    typeof each === "number" ? each / 2 : typeof each === "string" ? scaledRef(each, 0.5) : each,
  );

/**
 * The gain Web Audio's compressor makes up on its own: 0.6 of what it takes off a full-scale signal,
 * in dB. Worked out from the settings it starts with, since the engine's compressor takes makeup as
 * a setting.
 */
const webAudioMakeup = (threshold: NumberField | undefined, ratio: NumberField | undefined) => {
  const start = (field: NumberField | undefined, fallback: number) => (typeof field === "number" ? field : fallback);
  const [level, steepness] = [start(threshold, -24), Math.max(1, start(ratio, 12))];
  return Math.max(0, Math.min(24, 0.6 * -level * (1 - 1 / steepness)));
};

/** A sample player: the engine's sampler, its sample a param, gated by an envelope when it isn't a one-shot. */
const convertBuffer = (spec: Extract<NodeSpec, { kind: "buffer" }>, context: KindContext) => {
  const sample =
    typeof spec.sample === "string"
      ? context.addParam({ id: `${context.name}.sample`, label: "Sample", kind: "sample", default: spec.sample })
      : spec.sample.param;
  if (spec.start !== undefined || spec.trimEnd !== undefined) {
    context.note(`${context.name}'s start and trim end aren't converted yet: it plays the whole sample`);
  }
  // Not following the keys: always A4's frequency against A4 as the root, so it plays at its own pitch.
  const keytrack = spec.keytrack === undefined || spec.keytrack === true || typeof spec.keytrack !== "boolean";
  if (typeof spec.keytrack === "object")
    context.note(`${spec.keytrack.param} no longer switches key tracking: it's on`);
  const played = context.helper("play");
  context.add(played, "sampler", {
    frequency: detuned(
      context,
      keytrack ? "voice.frequency" : noteFrequency(69),
      spec.detune,
      context.modulators("detune"),
    ),
    gate: "voice.gate",
    sample: { param: sample },
    root: keytrack ? valueOf(spec.root, 60) : 69,
  });
  // A one-shot plays on after the note; otherwise it stops with it, after a short fade.
  const oneShot = spec.oneShot === undefined || spec.oneShot === true || typeof spec.oneShot !== "boolean";
  if (typeof spec.oneShot === "object") context.note(`${spec.oneShot.param} no longer switches one-shot: it's on`);
  const level = oneShot ? 1 : gateFade(context);
  ["left", "right"].forEach((side, channel) =>
    context.add(context.copy(channel), "mul", { a: `${played}.${side}`, b: level }),
  );
};

/** An envelope that is 1 while the note is held and fades out over 20 ms after. */
const gateFade = (context: KindContext) => {
  const name = context.helper("gate");
  context.add(name, "adsr", { gate: "voice.gate", attack: 0, decay: 0, sustain: 1, release: 0.02 });
  return name;
};
