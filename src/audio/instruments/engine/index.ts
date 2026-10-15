/** The built-in instruments, written in the engine's own format, in the order the library lists them. */
import { acid } from "./acid";
import { drumkit } from "./drumkit";
import { fm } from "./fm";
import { mellotronFlute } from "./mellotronFlute";
import { organ } from "./organ";
import { sampler } from "./sampler";
import { subtractive } from "./subtractive";
import { supersaw } from "./supersaw";
import { bell } from "./bell";
import { pad } from "./pad";
import { pluck } from "./pluck";
import { pluckBass } from "./pluckBass";
import { nimbus } from "./nimbus";
import { wavetable } from "./wavetable";
import { wobble } from "./wobble";
import type { EngineBuiltin } from "../../definitions/builtin";

export const ENGINE_INSTRUMENTS: readonly EngineBuiltin[] = [
  subtractive,
  fm,
  supersaw,
  organ,
  mellotronFlute,
  wavetable,
  nimbus,
  sampler,
  drumkit,
  pad,
  bell,
  pluck,
  pluckBass,
  acid,
  wobble,
];
