/**
 * The built-in devices written in the graph format: what the registries make, and what INST-36.8
 * converts onto the new engine. DOM-free, like the definitions themselves.
 */
import type { GraphEffectDef, GraphInstrumentDef } from "./types";
import { drumkit } from "../instruments/graph/drumkit";
import { fm } from "../instruments/graph/fm";
import { mellotronFlute } from "../instruments/graph/mellotronFlute";
import { organ } from "../instruments/graph/organ";
import { sampler } from "../instruments/graph/sampler";
import { subtractive } from "../instruments/graph/subtractive";
import { supersaw } from "../instruments/graph/supersaw";
import { bitcrusher } from "../effects/graph/bitcrusher";
import { chorus } from "../effects/graph/chorus";
import { delay } from "../effects/graph/delay";
import { distortion } from "../effects/graph/distortion";
import { filter } from "../effects/graph/filter";
import { reverb } from "../effects/graph/reverb";
import { tremolo } from "../effects/graph/tremolo";

export const BUILTIN_GRAPH_INSTRUMENTS: readonly GraphInstrumentDef[] = [
  subtractive,
  fm,
  mellotronFlute,
  supersaw,
  organ,
  sampler,
  drumkit,
];

export const BUILTIN_GRAPH_EFFECTS: readonly GraphEffectDef[] = [
  delay,
  distortion,
  reverb,
  filter,
  chorus,
  tremolo,
  bitcrusher,
];
