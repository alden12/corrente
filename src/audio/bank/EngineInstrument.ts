/**
 * An instrument played by the new engine (INST-36.5): a compiled definition on a track slot in an
 * engine bank. It is an `Instrument` like any other, so the track, the scheduler and live input
 * don't know which engine plays it while both exist.
 *
 * The slot arrives once the bank's worklet has loaded (the first time, the engine is fetched), so
 * whatever is sent before then waits and goes in order behind the plan. `ready` waits for the
 * worklet to say the plan is in, since an offline render outruns the messages that carry it.
 */
import type { CompiledPlan } from "../definitions/compile";
import { bindParams, type ParamBinding } from "../params/binding";
import type { ParamStore } from "../params/store";
import type { Instrument } from "../instruments/types";
import type { FromBank, ToBank } from "./messages";
import { takeSlot, type BankSlot } from "./pool";

/** A param's value as the engine reads it: numbers as they are, switches as 0 or 1. */
const numberOf = (value: unknown) => (typeof value === "number" ? value : value === true ? 1 : 0);

export class EngineInstrument implements Instrument {
  readonly output: GainNode;
  private readonly context: BaseAudioContext;
  private slot: BankSlot | null = null;
  private waiting: ToBank[] = [];
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private readonly arrived: Promise<void>;

  constructor(context: BaseAudioContext, store: ParamStore, plan: CompiledPlan) {
    this.context = context;
    this.output = new GainNode(context);
    let loaded = () => {};
    const heard = new Promise<void>((resolve) => (loaded = resolve));
    const listener = (message: FromBank) => {
      if (message.type === "refused") console.error(message.message);
      loaded();
    };
    this.arrived = takeSlot(context, listener).then((slot) => {
      if (this.disposed) {
        slot.release();
        return;
      }
      this.slot = slot;
      slot.node.connect(this.output, slot.track);
      const params = [...new Set(plan.params.map((source) => source.param))].filter((id) => store.has(id));
      const values = Object.fromEntries(params.map((id) => [id, numberOf(store.get(id))]));
      slot.post({ type: "load", track: slot.track, plan, values });
      this.waiting.forEach((message) => slot.post({ ...message, track: slot.track } as ToBank));
      this.waiting = [];
      const bindings: Record<string, ParamBinding> = Object.fromEntries(
        params.map((param) => [
          param,
          {
            apply: (value) =>
              this.send({ type: "param", param, value: numberOf(value), time: this.context.currentTime }),
          },
        ]),
      );
      this.unsubscribe = bindParams(store, bindings);
      return heard;
    });
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    this.send({ type: "noteOn", note: midi, velocity, time: when ?? this.context.currentTime });
  }

  noteOff(midi: number, when?: number): void {
    this.send({ type: "noteOff", note: midi, time: when ?? this.context.currentTime });
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const start = when ?? this.context.currentTime;
    this.noteOn(midi, velocity, start);
    this.noteOff(midi, start + durationSec);
  }

  allNotesOff(): void {
    this.send({ type: "allOff", time: this.context.currentTime });
  }

  /** Resolves once the plan is with the engine, so an offline render doesn't start silent. */
  ready(): Promise<void> {
    return this.arrived;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!this.slot) return;
    this.slot.node.disconnect(this.output, this.slot.track);
    this.slot.release();
    this.slot = null;
  }

  /** Send a message for this instrument's track, or keep it until the slot arrives. */
  private send(message: DistributiveOmit<ToBank, "track">): void {
    if (this.disposed) return;
    if (this.slot) this.slot.post({ ...message, track: this.slot.track } as ToBank);
    else this.waiting.push({ ...message, track: -1 } as ToBank);
  }
}

type DistributiveOmit<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;
