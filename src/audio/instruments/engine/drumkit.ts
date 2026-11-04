/**
 * Drum Kit: a zone per pad, each its own sample on its own note (the General MIDI drum map by
 * default), with a level and a tune. A note picks a pad rather than a pitch.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema } from "../../params/types";
import type { ParamSpec } from "../../params/types";
import { DEFAULT_KIT, builtinRef } from "../../samples/catalog";

// Drum kit: a multi-pad sample player. A played MIDI note *selects a pad* (it does not
// pitch the sample); which note fires a pad is a per-pad param (`pad{n}.note`), defaulting
// to the built-in sound's General MIDI drum note (kick = 36, snare = 38, ...) so the kit
// follows the GM standard - the mapping is data (visible in the panel, settable over MCP,
// freely remappable) rather than hardcoded.
// Each pad is a `sample` ref + note + level + tune, so the whole kit is schema-driven (no
// per-pad code) - the sectioned instrument panel renders one section per pad, and
// MCP/persistence come for free. Defaults load the built-in CC0 kit into the first pads.
// The definition below turns each pad into a zone, which picks the pad by its note.
// The schema declares the maximum pad slots; the drum panel shows only the pads in use
// (loaded, plus one you're adding) so a fresh kit isn't a wall of blanks.
export const DRUMKIT_PADS = 32;
export const DRUMKIT_BASE_NOTE = 36; // GM note 36 (kick), where the General MIDI drum map begins

/** The General MIDI hi-hats: closed (42), pedal (44) and open (46). */
const HI_HATS = [42, 44, 46];
/** The most choke groups a pad can pick from: enough for a kit's hats, cymbals and more. */
export const DRUMKIT_CHOKE_GROUPS = 8;

/**
 * A pad's default choke group, from its sound's General MIDI note (INST-9.2): the hi-hats share group 1,
 * so a closed hat stops the open one ringing, as a hand on the cymbals does. Everything else, none.
 */
export const chokeFor = (gmNote: number | undefined): number =>
  gmNote !== undefined && HI_HATS.includes(gmNote) ? 1 : 0;

/** Fallback default note for a 0-based pad index, for pads past the built-in kit (which
 *  seed their note from the sample's General MIDI note). Contiguous from the GM base. */
export const noteForPad = (padIndex: number): number => DRUMKIT_BASE_NOTE + padIndex;

/** A sound a kit puts on a pad by default: its sample ref, and its General MIDI note. */
export interface KitSound {
  sample: string;
  gmNote?: number;
}

/** The default kit's sounds, on the first pads. */
const DEFAULT_SOUNDS: KitSound[] = DEFAULT_KIT.samples.map((sample) => ({
  sample: builtinRef(sample.id),
  gmNote: sample.gmNote,
}));

/** Every pad's params, the first ones seeded with `sounds` (each on its GM note, its hats choked). */
export const drumPadSpecs = (sounds: readonly KitSound[] = DEFAULT_SOUNDS): ParamSpec[] =>
  Array.from({ length: DRUMKIT_PADS }, (_unused, index): ParamSpec[] => {
    const pad = index + 1;
    const sound = sounds[index];
    return [
      { id: `pad${pad}.sample`, label: "Sample", kind: "sample", default: sound?.sample ?? "" },
      {
        id: `pad${pad}.note`,
        label: "Note",
        kind: "number",
        min: 0,
        max: 127,
        // Follow the General MIDI drum map for the built-in kit (kick = 36, snare = 38,
        // ...); fall back to a contiguous layout for any extra pads.
        default: sound?.gmNote ?? noteForPad(index),
        taper: "linear",
        format: "note", // shown as a note-name selector (C2, ...), matching the piano roll
      },
      {
        id: `pad${pad}.level`,
        label: "Level",
        kind: "number",
        min: 0,
        max: 1,
        default: 0.85,
        taper: "linear",
        smoothMs: 10,
      },
      {
        id: `pad${pad}.tune`,
        label: "Tune",
        kind: "number",
        min: -24,
        max: 24,
        default: 0,
        unit: "st",
        taper: "linear",
        step: 1, // whole semitones
      },
      // 0 for none; a pad in a group cuts the group's other pads as it plays.
      {
        id: `pad${pad}.choke`,
        label: "Choke",
        kind: "number",
        min: 0,
        max: DRUMKIT_CHOKE_GROUPS,
        default: chokeFor(sound?.gmNote),
        taper: "linear",
        step: 1,
      },
    ];
  }).flat();

/**
 * A kit's whole schema: its pads, seeded with `sounds`, and the shared envelope and level. `release` is
 * how long a pad takes to die away once let go: short for the built-in one-shots, long for a recorded
 * cymbal, which a quick tap shouldn't cut off.
 */
export const kitSchema = (sounds?: readonly KitSound[], release = 40): ParamSchema => [
  ...drumPadSpecs(sounds),
  // A short shared amp envelope (pads are one-shots, so these mostly just soften the
  // very start/end); amp.level is the kit master. env.* are required by the shared voice.
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 1,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: release,
    unit: "ms",
    taper: "exponential",
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.9, taper: "linear", smoothMs: 10 },
];

export const drumkitSchema: ParamSchema = kitSchema();

export const drumkit: EngineBuiltin = {
  type: "drumkit",
  label: "Drum Kit",
  family: "Percussion",
  tags: ["percussion"],
  color: "pink",
  schema: drumkitSchema,
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      player: {
        block: "sampler",
        voice: true,
        inputs: {
          frequency: "voice.frequency",
          gate: "voice.gate",
          sample: "voice.sample",
          root: "voice.root",
          start: "voice.start",
          end: "voice.end",
        },
      },
      envelope: {
        block: "adsr",
        voice: true,
        inputs: {
          gate: "voice.gate",
          attack: { param: "env.attack", scale: 0.001 },
          decay: 0,
          sustain: 1,
          release: { param: "env.release", scale: 0.001 },
        },
      },
      amp: {
        block: "mul",
        voice: true,
        stereo: true,
        inputs: { a: { left: "player.left", right: "player.right" }, b: "envelope" },
      },
      level: { block: "mul", stereo: true, inputs: { a: "voices", b: { param: "amp.level" } } },
    },
    voice: "amp",
    output: "level",
    // A zone per pad, on its own note: the note picks the pad, and plays it at its own pitch.
    zones: Array.from({ length: DRUMKIT_PADS }, (_, index) => {
      const pad = `pad${index + 1}`;
      return {
        sample: { param: `${pad}.sample` },
        root: 60,
        keys: [{ param: `${pad}.note` }, { param: `${pad}.note` }],
        tune: { param: `${pad}.tune` },
        level: { param: `${pad}.level` },
        keytrack: false,
        choke: { param: `${pad}.choke` },
      };
    }),
  },
};
