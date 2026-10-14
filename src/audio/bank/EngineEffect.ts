/**
 * An effect run by the new engine (INST-36.7): an `EngineDevice` whose definition reads
 * `input.left` and `input.right`, fed by what comes before it in the chain. It is an `Effect` like
 * any other, so it sits in a track's or a group's chain, after an instrument on either engine or an
 * audio track's clips. The uniform `mix` crossfades around it, as for every effect (BaseEffect).
 *
 * Its `stage` keeps its slot in a bank after the one feeding it: a bank is one worklet node, and
 * audio that came out of a node and went back into it would be a loop, which Web Audio silences.
 */
import type { CompiledPlan } from "../definitions/compile";
import { BaseEffect } from "../effects/BaseEffect";
import type { ParamBinding } from "../params/binding";
import type { ParamStore } from "../params/store";
import { EngineDevice } from "./EngineDevice";

export class EngineEffect extends BaseEffect {
  private readonly plan: CompiledPlan;
  readonly stage: number;
  private device: EngineDevice | null = null;

  constructor(context: BaseAudioContext, store: ParamStore, plan: CompiledPlan, stage: number) {
    super(context, store);
    this.plan = plan;
    this.stage = stage;
    this.init();
  }

  protected buildGraph(): void {
    this.device = new EngineDevice(this.ctx, this.store, this.plan, { stage: this.stage, input: this.input });
    this.device.output.connect(this.wet);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return this.commonBindings();
  }

  /** Resolves once the plan and its samples are with the engine. */
  ready(): Promise<void> {
    return this.device?.ready() ?? Promise.resolve();
  }

  protected teardown(): void {
    this.device?.dispose();
    this.device = null;
  }
}
