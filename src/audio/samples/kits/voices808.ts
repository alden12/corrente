/**
 * The 808 kit's voices (INST-9.1), each a small engine device built from the catalogue's blocks: a
 * kick's falling sine, a snare's two tones and its noise, a hat's six detuned squares. `yarn kits`
 * renders each into its sample (`assets/<id>.wav`), which the 808 kit's pads play.
 *
 * Synthesized, not sampled, so nothing here is anyone else's recording. Rendering to samples rather
 * than playing the voices live is the first step: the engine plays one voice design per device, so a
 * kit whose pads are each their own design waits on per-pad voices (INST-16). These definitions are
 * what those pads will run.
 *
 * DOM-free data, like a device file. Each voice holds its gate for its whole length, so its
 * envelopes' decays shape it; sustain is 0 throughout.
 */
import type { AuthoredDefinition } from "../../definitions/format";

/** One sound of the kit: the sample it renders to, how long, and the device that makes it. */
export interface KitVoice {
  /** The built-in sample's id (catalog.ts), and so its file's name. */
  id: string;
  seconds: number;
  definition: AuthoredDefinition;
}

type Nodes = AuthoredDefinition["nodes"];
type Signal = string | { from: string; scale: number };

/** A one-shot envelope: up at once, then down to nothing over `decay` seconds. */
const decayEnvelope = (decay: number, attack = 0.001) => ({
  block: "adsr",
  voice: true,
  inputs: { gate: "voice.gate", attack, decay, sustain: 0, release: decay },
});

/**
 * A sine at `frequency` that starts `bend` semitones above it and falls back over `fall` seconds:
 * the pitch drop that makes a kick or a tom. Named `name`, with its helpers beside it.
 */
const droppingSine = (name: string, frequency: number, bend: number, fall: number): Nodes => ({
  [`${name}Drop`]: decayEnvelope(fall),
  [`${name}Pitch`]: {
    block: "pitch",
    voice: true,
    inputs: { frequency, semitones: { from: `${name}Drop`, scale: bend } },
  },
  [name]: { block: "sine", voice: true, inputs: { frequency: `${name}Pitch` } },
});

/** Signals summed and shaped by an envelope (or scaled by a number). */
const amplify = (signals: Signal | Signal[], envelope: string | number) => ({
  block: "mul",
  voice: true,
  inputs: { a: signals, b: envelope },
});

const sine = (frequency: number) => ({ block: "sine", voice: true, inputs: { frequency } });
const square = (frequency: number) => ({ block: "pulse", voice: true, inputs: { frequency, width: 0.5 } });
const filter = (signal: Signal | Signal[], cutoff: number, q: number) => ({
  block: "svf",
  voice: true,
  inputs: { signal, cutoff, q },
});

/** A definition that plays `voice`, one note at a time. */
const device = (nodes: Nodes, voice: string): AuthoredDefinition => ({ format: 1, voices: 1, nodes, voice });

/** A tom: a sine dropping a fifth or so, ringing for `decay`. */
const tom = (id: string, frequency: number, decay: number): KitVoice => ({
  id,
  seconds: decay * 1.6,
  definition: device(
    { ...droppingSine("body", frequency, 7, 0.06), level: decayEnvelope(decay), out: amplify("body", "level") },
    "out",
  ),
});

/**
 * The hats' metal: six squares at the 808's odd, unrelated pitches, band-passed high and then
 * high-passed, so what is left is a bright, clangy hiss rather than a chord.
 */
const HAT_PITCHES = [205.3, 304.4, 369.6, 522.7, 540, 800];
const hat = (id: string, decay: number): KitVoice => ({
  id,
  seconds: decay * 2.5,
  definition: device(
    {
      ...Object.fromEntries(HAT_PITCHES.map((pitch, index) => [`square${index}`, square(pitch)])),
      band: filter(
        HAT_PITCHES.map((_, index) => ({ from: `square${index}`, scale: 0.12 })),
        9000,
        0.8,
      ),
      air: filter("band.bandpass", 7000, 0.7),
      level: decayEnvelope(decay),
      out: amplify("air.highpass", "level"),
    },
    "out",
  ),
});

/** Samples between a clap's hits at the rate `yarn kits` renders at: about 10 ms. */
const CLAP_GAP = 441;

export const VOICES_808: KitVoice[] = [
  // A long sine boom, its pitch falling from two and a half octaves up, a little driven.
  {
    id: "808-kick",
    seconds: 1.3,
    definition: device(
      {
        ...droppingSine("body", 50, 30, 0.035),
        level: decayEnvelope(1.1),
        boom: amplify("body", "level"),
        out: { block: "shaper", voice: true, inputs: { signal: "boom", drive: 1.6 } },
      },
      "out",
    ),
  },
  // Two short tones for the drum, and high-passed noise for the snares on it.
  {
    id: "808-snare",
    seconds: 0.35,
    definition: device(
      {
        ...droppingSine("low", 180, 3, 0.02),
        high: sine(330),
        toneLevel: decayEnvelope(0.11),
        tone: amplify(
          [
            { from: "low", scale: 0.5 },
            { from: "high", scale: 0.35 },
          ],
          "toneLevel",
        ),
        noise: { block: "noise", voice: true },
        hiss: filter("noise", 1800, 0.9),
        snapLevel: decayEnvelope(0.19),
        snap: amplify({ from: "hiss.highpass", scale: 0.6 }, "snapLevel"),
        out: { block: "add", voice: true, inputs: { a: "tone", b: "snap" } },
      },
      "out",
    ),
  },
  hat("808-hat-closed", 0.05),
  hat("808-hat-open", 0.42),
  // Band-passed noise struck three times in quick succession, then a short room of it.
  {
    id: "808-clap",
    seconds: 0.4,
    definition: device(
      {
        noise: { block: "noise", voice: true },
        band: filter("noise", 1200, 1.4),
        hitLevel: decayEnvelope(0.009),
        hit: amplify("band.bandpass", "hitLevel"),
        second: { block: "delay", voice: true, inputs: { signal: "hit", length: CLAP_GAP } },
        third: { block: "delay", voice: true, inputs: { signal: "hit", length: CLAP_GAP * 2 } },
        roomLevel: decayEnvelope(0.16),
        room: amplify("band.bandpass", "roomLevel"),
        late: { block: "delay", voice: true, inputs: { signal: "room", length: CLAP_GAP * 3 } },
        out: amplify(["hit", "second", "third", "late"], 0.7),
      },
      "out",
    ),
  },
  // Two high tones, very short, with the low end taken out: a click with a pitch.
  {
    id: "808-rim",
    seconds: 0.12,
    definition: device(
      {
        low: sine(455),
        high: sine(1667),
        thin: filter(["low", "high"], 250, 0.7),
        level: decayEnvelope(0.022),
        out: amplify({ from: "thin.highpass", scale: 0.5 }, "level"),
      },
      "out",
    ),
  },
  tom("808-tom-low", 100, 0.45),
  tom("808-tom-mid", 150, 0.38),
  tom("808-tom-high", 220, 0.32),
  // Two squares a fifth-and-a-bit apart, band-passed into a hollow knock.
  {
    id: "808-cowbell",
    seconds: 0.5,
    definition: device(
      {
        low: square(540),
        high: square(800),
        hollow: filter(
          [
            { from: "low", scale: 0.25 },
            { from: "high", scale: 0.25 },
          ],
          1600,
          1.6,
        ),
        level: decayEnvelope(0.32),
        out: amplify("hollow.bandpass", "level"),
      },
      "out",
    ),
  },
];
