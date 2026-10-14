/**
 * An instrument played by the new engine (INST-36.5): an `EngineDevice` at the first stage, taking
 * notes. It is an `Instrument` like any other, so the track, the scheduler and live input don't know
 * which engine plays it while both exist. Its plan may carry the engine effects after it too
 * (INST-36.7, chainPlan.ts), reloaded in place when they change.
 */
import type { CompiledPlan } from "../definitions/compile";
import type { Instrument } from "../instruments/types";
import type { ChainLayout, ChainPlan } from "./chainPlan";
import { EngineDevice, type ParamSources } from "./EngineDevice";
import { INSTRUMENT_STAGE } from "./stages";

export class EngineInstrument implements Instrument {
  private readonly device: EngineDevice;
  readonly output: GainNode;
  /** The bypass param of each effect its plan carries, by effect id. */
  bypass = new Map<string, string>();

  constructor(context: BaseAudioContext, plan: CompiledPlan, sources: ParamSources, chain?: ChainLayout) {
    this.device = new EngineDevice(context, plan, sources, { stage: INSTRUMENT_STAGE }, chain);
    this.output = this.device.output;
    if (chain) this.bypass = chain.bypass;
  }

  /**
   * Play another chain plan (the instrument with other effects after it), notes kept: what it keeps
   * carries on, or else it crossfades.
   */
  reload(chain: ChainPlan): void {
    this.bypass = chain.bypass;
    this.device.reload(chain.plan, chain.sources, chain);
  }

  /** Set a param no store holds: an effect's bypass in the instrument's chain. */
  setFixed(param: string, value: number): void {
    this.device.setFixed(param, value);
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    this.device.send({ type: "noteOn", note: midi, velocity, time: when ?? this.device.context.currentTime });
  }

  noteOff(midi: number, when?: number): void {
    this.device.send({ type: "noteOff", note: midi, time: when ?? this.device.context.currentTime });
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const start = when ?? this.device.context.currentTime;
    this.noteOn(midi, velocity, start);
    this.noteOff(midi, start + durationSec);
  }

  allNotesOff(): void {
    this.device.send({ type: "allOff", time: this.device.context.currentTime });
  }

  /** How many samples late its output is. */
  get latency(): number {
    return this.device.latency;
  }

  /** Resolves once the plan and its samples are with the engine, so an offline render doesn't start silent. */
  ready(): Promise<void> {
    return this.device.ready();
  }

  dispose(): void {
    this.device.dispose();
  }
}
