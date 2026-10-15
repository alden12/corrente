/** The effects written in the engine's own format (INST-42), in the order the library lists them. */
import { autoPan } from "./autoPan";
import { ensemble } from "./ensemble";
import { flanger } from "./flanger";
import { lofi } from "./lofi";
import { phaser } from "./phaser";
import { pingPong } from "./pingPong";
import { pump } from "./pump";
import { resonator } from "./resonator";
import { sidechainCompressor } from "./sidechainCompressor";
import { tapeEcho } from "./tapeEcho";
import { widener } from "./widener";
import type { EngineBuiltin } from "../../definitions/builtin";

export const ENGINE_EFFECTS: readonly EngineBuiltin[] = [
  pingPong,
  tapeEcho,
  phaser,
  flanger,
  ensemble,
  autoPan,
  pump,
  lofi,
  widener,
  resonator,
  sidechainCompressor,
];
