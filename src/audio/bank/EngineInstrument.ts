/**
 * An instrument played by the new engine (INST-36.5): an `EngineDevice` at the first stage, taking
 * notes. It is an `Instrument` like any other, so the track, the scheduler and live input don't know
 * which engine plays it while both exist.
 */
import type { CompiledPlan } from "../definitions/compile";
import type { Instrument } from "../instruments/types";
import type { ParamStore } from "../params/store";
import { EngineDevice } from "./EngineDevice";
import { INSTRUMENT_STAGE } from "./stages";

export class EngineInstrument implements Instrument {
  private readonly device: EngineDevice;
  readonly output: GainNode;

  constructor(context: BaseAudioContext, store: ParamStore, plan: CompiledPlan) {
    this.device = new EngineDevice(context, store, plan, { stage: INSTRUMENT_STAGE });
    this.output = this.device.output;
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

  /** Resolves once the plan and its samples are with the engine, so an offline render doesn't start silent. */
  ready(): Promise<void> {
    return this.device.ready();
  }

  dispose(): void {
    this.device.dispose();
  }
}
