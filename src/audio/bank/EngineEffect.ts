/**
 * Effects run by the new engine (INST-36.7): an `EngineDevice` fed by what comes before it in the
 * chain, playing a run of one or more engine effects composed into one plan (chainPlan.ts), each
 * effect's mix and bypass inside it. It is an `Effect` like any other, so it sits in a track's or a
 * group's chain, after an instrument on either engine or an audio track's clips.
 *
 * Its `stage` keeps its slot in a bank after the one feeding it: a bank is one worklet node, and
 * audio that came out of a node and went back into it would be a loop, which Web Audio silences.
 */
import type { CompiledPlan } from "../definitions/compile";
import type { Effect } from "../effects/types";
import type { ChainLayout, ChainPlan } from "./chainPlan";
import { EngineDevice, type ParamSources } from "./EngineDevice";

export class EngineEffect implements Effect {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly stage: number;
  /** Each of its effects' bypass param in its plan, by effect id. */
  bypass = new Map<string, string>();
  private readonly device: EngineDevice;

  constructor(
    context: BaseAudioContext,
    plan: CompiledPlan,
    sources: ParamSources,
    stage: number,
    chain?: ChainLayout,
    sidechain?: AudioNode,
  ) {
    this.input = new GainNode(context);
    this.stage = stage;
    this.device = new EngineDevice(context, plan, sources, { stage, input: this.input, sidechain }, chain);
    this.output = this.device.output;
    if (chain) this.bypass = chain.bypass;
  }

  /** Play another run's plan on the same slot: the effects it keeps carry on, or else it crossfades. */
  reload(chain: ChainPlan): void {
    this.bypass = chain.bypass;
    this.device.reload(chain.plan, chain.sources, chain);
  }

  /** Set a param no store holds: an effect's bypass in the run. */
  setFixed(param: string, value: number): void {
    this.device.setFixed(param, value);
  }

  /** How many samples late its output is. */
  get latency(): number {
    return this.device.latency;
  }

  /** Resolves once the plan and its samples are with the engine. */
  ready(): Promise<void> {
    return this.device.ready();
  }

  dispose(): void {
    this.device.dispose();
    this.input.disconnect();
  }
}
