/**
 * The project's key (DAW-12): a tonic and a scale, set per song. The pads and the computer keyboard
 * play in it, Claude composes in it, and the engine hears it for the MIDI nodes that work in degrees.
 * DOM-free, so the MCP servers share it. A project from before keys plays in C major.
 */
import { z } from "zod";
import { PITCH_CLASSES, SCALE_NAMES, SCALES, type ScaleName } from "./scales";

export interface ProjectKey {
  /** The tonic's pitch class, 0 (C) to 11 (B). */
  tonic: number;
  scale: ScaleName;
}

export const DEFAULT_KEY: ProjectKey = { tonic: 0, scale: "major" };

export const keySchema = z.object({
  tonic: z
    .number()
    .int()
    .min(0)
    .max(PITCH_CLASSES.length - 1),
  scale: z.enum(SCALE_NAMES as [ScaleName, ...ScaleName[]]),
});

/** "C major", "F# dorian". */
export const keyLabel = (key: ProjectKey): string => `${PITCH_CLASSES[key.tonic]} ${key.scale}`;

/**
 * Every name a tonic goes by, sharps and flats alike, and its pitch class: what an agent may write
 * (it will often reach for a flat key, Bb or Eb). The key is stored as a pitch class, so either
 * spelling is the same key.
 */
export const TONIC_NAMES: Readonly<Record<string, number>> = {
  ...Object.fromEntries(PITCH_CLASSES.map((name, pitchClass) => [name, pitchClass])),
  Db: 1,
  Eb: 3,
  Gb: 6,
  Ab: 8,
  Bb: 10,
  Cb: 11,
  Fb: 4,
  "E#": 5,
  "B#": 0,
};

/** The key in parts, for an agent to read without parsing the label. */
export const keyParts = (key: ProjectKey) => ({
  tonic: PITCH_CLASSES[key.tonic],
  scale: key.scale,
  label: keyLabel(key),
});

/** A scale as the engine reads it: bit n set when the note n semitones above the tonic is in it. */
export const scaleMask = (scale: ScaleName): number =>
  (SCALES[scale] as readonly number[]).reduce((mask, interval) => mask | (1 << interval), 0);
