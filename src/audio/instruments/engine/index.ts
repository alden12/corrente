/** The instruments written in the engine's own format (INST-42), in the order the library lists them. */
import { acid } from "./acid";
import { bell } from "./bell";
import { pad } from "./pad";
import { pluck } from "./pluck";
import { pluckBass } from "./pluckBass";
import { wobble } from "./wobble";
import type { EngineBuiltin } from "../../definitions/builtin";

export const ENGINE_INSTRUMENTS: readonly EngineBuiltin[] = [pad, bell, pluck, pluckBass, acid, wobble];
