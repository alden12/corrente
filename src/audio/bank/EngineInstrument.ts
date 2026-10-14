/**
 * An instrument played by the new engine (INST-36.5): a compiled definition on a track slot in an
 * engine bank. It is an `Instrument` like any other, so the track, the scheduler and live input
 * don't know which engine plays it while both exist.
 *
 * The slot arrives once the bank's worklet has loaded (the first time, the engine is fetched), so
 * whatever is sent before then waits and goes in order behind the plan. `ready` waits for the
 * worklet to say the plan is in, since an offline render outruns the messages that carry it.
 *
 * A sample param (INST-36.6) names a sample: each time it changes, the sample is decoded here (the
 * worklet can't decode) and sent to the bank, which keeps it in a slot by name. `ready` waits for
 * those too, so an offline render doesn't start before its samples are in.
 */
import type { CompiledPlan } from "../definitions/compile";
import { engineValueOf } from "../definitions/values";
import { loadSampleBuffer } from "../samples/builtinUrls";
import { bindParams, type ParamBinding } from "../params/binding";
import type { ParamStore } from "../params/store";
import type { Instrument } from "../instruments/types";
import type { SampleAudio } from "./bank";
import type { FromBank, ToBank } from "./messages";
import { takeSlot, type BankSlot } from "./pool";

export class EngineInstrument implements Instrument {
  readonly output: GainNode;
  private readonly context: BaseAudioContext;
  private slot: BankSlot | null = null;
  private waiting: ToBank[] = [];
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private readonly arrived: Promise<void>;
  /** Each sample param's latest sample, done once the bank has it. */
  private readonly samples = new Map<string, { ref: string; done: Promise<void> }>();
  /** What to call when the bank says it has dealt with a param's sample, by param and ref. */
  private readonly sampled = new Map<string, () => void>();

  constructor(context: BaseAudioContext, store: ParamStore, plan: CompiledPlan) {
    this.context = context;
    this.output = new GainNode(context);
    let loaded = () => {};
    const heard = new Promise<void>((resolve) => (loaded = resolve));
    const listener = (message: FromBank) => {
      if (message.type === "sampled") {
        if (message.message) console.error(message.message);
        this.sampled.get(sampleKey(message.param, message.ref))?.();
        return;
      }
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
      const used = (sample: boolean) =>
        [...new Set(plan.params.filter((source) => !!source.sample === sample).map((source) => source.param))].filter(
          (id) => store.has(id),
        );
      const params = used(false);
      const values = Object.fromEntries(params.map((id) => [id, engineValueOf(store.spec(id), store.get(id))]));
      slot.post({ type: "load", track: slot.track, plan, values });
      this.waiting.forEach((message) => slot.post({ ...message, track: slot.track } as ToBank));
      this.waiting = [];
      const bindings: Record<string, ParamBinding> = Object.fromEntries([
        ...params.map((param): [string, ParamBinding] => [
          param,
          {
            apply: (value) =>
              this.send({
                type: "param",
                param,
                value: engineValueOf(store.spec(param), value),
                time: this.context.currentTime,
              }),
          },
        ]),
        ...used(true).map((param): [string, ParamBinding] => [
          param,
          { apply: (value) => this.sendSample(param, String(value)) },
        ]),
      ]);
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

  /** Resolves once the plan and its samples are with the engine, so an offline render doesn't start silent. */
  async ready(): Promise<void> {
    await this.arrived;
    await Promise.all([...this.samples.values()].map((sample) => sample.done));
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

  /**
   * Decode the sample `ref` names and send it to the bank for `param`, unless the param has moved on
   * by the time it's decoded. A sample that won't decode is sent as none.
   */
  private sendSample(param: string, ref: string): void {
    if (this.samples.get(param)?.ref === ref) return;
    const request = { ref, done: Promise.resolve() };
    this.samples.set(param, request);
    const key = sampleKey(param, ref);
    let heard: (() => void) | undefined;
    request.done = loadSampleBuffer(this.context, ref)
      .catch((error: unknown) => {
        console.error(`${param}: couldn't decode ${ref}`, error);
        return null;
      })
      .then((buffer) => {
        if (this.disposed || this.samples.get(param) !== request) return;
        const audio: SampleAudio | null = buffer && {
          channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) =>
            buffer.getChannelData(channel).slice(),
          ),
          rate: buffer.sampleRate,
        };
        const answered = new Promise<void>((resolve) => this.sampled.set(key, (heard = resolve)));
        this.send({ type: "sample", param, ref, audio });
        return answered;
      })
      .finally(() => {
        // Only this request's own: a later one for the same sample may be waiting too.
        if (this.sampled.get(key) === heard) this.sampled.delete(key);
      });
  }

  /** Send a message for this instrument's track, or keep it until the slot arrives. */
  private send(message: DistributiveOmit<ToBank, "track">): void {
    if (this.disposed) return;
    if (this.slot) this.slot.post({ ...message, track: this.slot.track } as ToBank);
    else this.waiting.push({ ...message, track: -1 } as ToBank);
  }
}

const sampleKey = (param: string, ref: string) => `${param}\n${ref}`;

type DistributiveOmit<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;
