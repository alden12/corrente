/**
 * Effects run by the new engine (INST-36.7): an `EngineDevice` fed by what comes before it in the
 * chain, playing a run of one or more engine effects composed into one plan (chainPlan.ts), each
 * effect's mix and bypass inside it. It is an `Effect` like any other, so it sits in a track's or a
 * group's chain, after an instrument on either engine or an audio track's clips.
 *
 * Its `stage` keeps its slot in a bank after the one feeding it: a bank is one worklet node, and
 * audio that came out of a node and went back into it would be a loop, which Web Audio silences.
 */
import type { Effect } from "../effects/types";
import type { ChainPlan } from "./chainPlan";
import { EngineDevice } from "./EngineDevice";

export class EngineEffect extends EngineDevice implements Effect {
  readonly input: GainNode;
  readonly stage: number;

  /** `sidechain`: what keys it, for a keyed effect (part 5). */
  constructor(context: BaseAudioContext, chain: ChainPlan, stage: number, sidechain?: AudioNode) {
    const input = new GainNode(context);
    super(context, chain, { stage, input, sidechain });
    this.input = input;
    this.stage = stage;
  }

  dispose(): void {
    super.dispose();
    this.input.disconnect();
  }
}
