/**
 * Acoustic Kit (INST-9.3): Versilian's Virtuosity Drums, a real kit recorded with sticks, each hit its
 * overheads and close mics mixed down, a few velocity layers and round robins of each. An instrument
 * of its own, as the Grand Piano is: it plays as the Drum Kit does, its pads seeded with the recordings
 * on their General MIDI notes and its hats choked, and it gets the drum UI by its pad params (INST-54).
 * The recordings load on first use (INST-55).
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import { factoryRef } from "../../samples/factory";
import { drumkit, kitSchema, type KitSound } from "./drumkit";

/** The kit in playing order, so the keys from Z run kick, snare, hats, then the rest. */
const SOUNDS: [sound: string, gmNote: number][] = [
  ["kick", 36],
  ["snare", 38],
  ["hat-closed", 42],
  ["hat-open", 46],
  ["hat-pedal", 44],
  ["side-stick", 37],
  ["rimshot", 40],
  ["low-tom", 41],
  ["high-tom", 48],
  ["crash", 49],
  ["ride", 51],
  ["ride-bell", 53],
];

const sounds: KitSound[] = SOUNDS.map(([sound, gmNote]) => ({ sample: factoryRef("virtuosity", sound), gmNote }));

export const acousticKit: EngineBuiltin = {
  ...drumkit,
  type: "acoustic-kit",
  label: "Acoustic Kit",
  tags: ["percussion", "warm"],
  color: "amber",
  // A let-go pad rings on: a crash tapped is still a crash.
  schema: kitSchema(sounds, 4000),
};
