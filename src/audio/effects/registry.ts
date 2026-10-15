/**
 * The effect a chain makes for a type that isn't on the engine (the audio side; uses Web Audio).
 * Every built-in and every playable custom effect runs on the engine, made in its chain's run
 * (ChainEffects, INST-36.7); what's left is a custom effect too old to play, or a type nothing
 * registers. It passes its input through, so the rest of the chain still plays.
 */
import type { Effect } from "./types";

export function passThroughEffect(context: BaseAudioContext): Effect {
  const node = context.createGain();
  return { input: node, output: node, dispose: () => node.disconnect() };
}
