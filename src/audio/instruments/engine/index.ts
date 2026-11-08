/** The built-in instruments, written in the engine's own format, in the order the library lists them. */
import { acid } from "./acid";
import { drumkit } from "./drumkit";
import { acousticKit } from "./acousticKit";
import { kit808 } from "./kit808";
import { fm } from "./fm";
import { mellotronFlute } from "./mellotronFlute";
import { microVa } from "./microVa";
import { glideLead } from "./glideLead";
import { grandPiano } from "./grandPiano";
import { tinePiano } from "./tinePiano";
import { organ } from "./organ";
import { sampler } from "./sampler";
import { subtractive } from "./subtractive";
import { supersaw } from "./supersaw";
import { bell } from "./bell";
import { pad } from "./pad";
import { gatePad } from "./gatePad";
import { pluck } from "./pluck";
import { pluckBass } from "./pluckBass";
import { nimbus } from "./nimbus";
import { wavetable } from "./wavetable";
import { hybridWave } from "./hybridWave";
import { wobble } from "./wobble";
import type { EngineBuiltin } from "../../definitions/builtin";

export const ENGINE_INSTRUMENTS: readonly EngineBuiltin[] = [
  subtractive,
  fm,
  supersaw,
  grandPiano,
  tinePiano,
  organ,
  mellotronFlute,
  wavetable,
  hybridWave,
  microVa,
  glideLead,
  nimbus,
  sampler,
  // The kits, the recorded one first.
  acousticKit,
  drumkit,
  kit808,
  pad,
  gatePad,
  bell,
  pluck,
  pluckBass,
  acid,
  wobble,
];
