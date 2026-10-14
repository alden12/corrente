/**
 * A device on the new engine (INST-36.5): a compiled definition on a track slot in an engine bank,
 * its params kept in step with its ParamStore. `EngineInstrument` plays notes on one and
 * `EngineEffect` feeds audio through one, so tracks don't know which engine they're on while both
 * exist.
 *
 * The slot arrives once the bank's worklet has loaded (the first time, the engine is fetched), so
 * whatever is sent before then waits and goes in order behind the plan. `ready` waits for the
 * worklet to say the plan is in, since an offline render outruns the messages that carry it.
 *
 * A sample param (INST-36.6) names a sample: each time it changes, the sample is decoded here (the
 * worklet can't decode) and sent to the bank, which keeps it in a slot by name. One a wavetable plays
 * is sent as a table, band-limited (samples/tables.ts), under its own name. `ready` waits for
 * those too, so an offline render doesn't start before its samples are in.
 */
import type { CompiledPlan } from "../definitions/compile";
import { engineValueOf } from "../definitions/values";
import { buildBanks } from "../dsp/wavetable";
import { loadSampleBuffer } from "../samples/builtinUrls";
import { BUILTIN_WAVETABLES, parseRef } from "../samples/catalog";
import { cyclesOf, tableOf } from "../samples/tables";
import { bindParams, type ParamBinding } from "../params/binding";
import type { ParamStore } from "../params/store";
import type { SampleAudio } from "./bank";
import type { FromBank, ToBank } from "./messages";
import { mainInput, takeSlot, type BankSlot } from "./pool";

/** Where a device's slot is: which stage of the signal flow, and audio to feed its input. */
export interface DevicePlace {
  /** The stage its bank serves (`takeSlot`): instruments 0, effects after what feeds them. */
  stage: number;
  /** What to play into the slot's input, for an effect. */
  input?: AudioNode;
}

export class EngineDevice {
  /** The slot's output, once it arrives: silent until then. */
  readonly output: GainNode;
  readonly context: BaseAudioContext;
  private readonly input: AudioNode | undefined;
  private slot: BankSlot | null = null;
  private waiting: ToBank[] = [];
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private readonly arrived: Promise<void>;
  /** Each sample param's latest sample, done once the bank has it. */
  private readonly samples = new Map<string, { ref: string; done: Promise<void> }>();
  /** What to call when the bank says it has dealt with a param's sample, by param and ref. */
  private readonly sampled = new Map<string, () => void>();

  constructor(context: BaseAudioContext, store: ParamStore, plan: CompiledPlan, place: DevicePlace) {
    this.context = context;
    this.input = place.input;
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
    this.arrived = takeSlot(context, listener, place.stage).then((slot) => {
      if (this.disposed) {
        slot.release();
        return;
      }
      this.slot = slot;
      slot.node.connect(this.output, slot.track);
      this.input?.connect(slot.node, 0, mainInput(slot.track));
      const used = (sample: boolean) =>
        [...new Set(plan.params.filter((source) => !!source.sample === sample).map((source) => source.param))].filter(
          (id) => store.has(id),
        );
      const params = used(false);
      const tables = new Set(plan.params.filter((source) => source.wavetable).map((source) => source.param));
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
          { apply: (value) => this.sendSample(param, String(value), tables.has(param)) },
        ]),
      ]);
      this.unsubscribe = bindParams(store, bindings);
      return heard;
    });
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
    this.input?.disconnect(this.slot.node, 0, mainInput(this.slot.track));
    this.slot.release();
    this.slot = null;
  }

  /**
   * Decode the sample `ref` names and send it to the bank for `param`, unless the param has moved on
   * by the time it's decoded. A sample that won't decode is sent as none.
   */
  private sendSample(param: string, sampleRef: string, asTable: boolean): void {
    // A table is the bank's own thing, apart from the same sample played as one.
    const ref = sampleRef && asTable ? `table:${sampleRef}` : sampleRef;
    if (this.samples.get(param)?.ref === ref) return;
    const request = { ref, done: Promise.resolve() };
    this.samples.set(param, request);
    const key = sampleKey(param, ref);
    let heard: (() => void) | undefined;
    request.done = (asTable ? tableAudio(this.context, sampleRef) : sampleAudio(this.context, sampleRef))
      .catch((error: unknown) => {
        console.error(`${param}: couldn't load ${sampleRef}`, error);
        return null;
      })
      .then((audio) => {
        if (this.disposed || this.samples.get(param) !== request) return;
        const answered = new Promise<void>((resolve) => this.sampled.set(key, (heard = resolve)));
        this.send({ type: "sample", param, ref, audio });
        return answered;
      })
      .finally(() => {
        // Only this request's own: a later one for the same sample may be waiting too.
        if (this.sampled.get(key) === heard) this.sampled.delete(key);
      });
  }

  /** Send a message for this device's track, or keep it until the slot arrives. */
  send(message: DistributiveOmit<ToBank, "track">): void {
    if (this.disposed) return;
    if (this.slot) this.slot.post({ ...message, track: this.slot.track } as ToBank);
    else this.waiting.push({ ...message, track: -1 } as ToBank);
  }
}

const sampleKey = (param: string, ref: string) => `${param}\n${ref}`;

/** A sample decoded: up to two channels at its own rate, or null for none. */
const sampleAudio = async (context: BaseAudioContext, ref: string): Promise<SampleAudio | null> => {
  const buffer = await loadSampleBuffer(context, ref);
  return (
    buffer && {
      channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) =>
        buffer.getChannelData(channel).slice(),
      ),
      rate: buffer.sampleRate,
    }
  );
};

/** Built-in wavetables, made once each: their levels take a moment to work out. */
const builtinTables = new Map<string, Float32Array>();

/**
 * A wavetable, band-limited at every level the engine reads: a built-in, or a sample's first channel
 * cut into 2048-sample cycles. Null for none, or a sample shorter than a cycle.
 */
const tableAudio = async (context: BaseAudioContext, ref: string): Promise<SampleAudio | null> => {
  const parsed = parseRef(ref);
  if (parsed.kind === "wavetable") {
    const index = BUILTIN_WAVETABLES.findIndex((table) => table.id === parsed.id);
    if (index < 0) return null;
    const table = builtinTables.get(parsed.id) ?? tableOf(buildBanks()[index]);
    builtinTables.set(parsed.id, table);
    return { channels: [table], rate: context.sampleRate };
  }
  const buffer = await loadSampleBuffer(context, ref);
  const cycles = buffer ? cyclesOf(buffer.getChannelData(0)) : [];
  return cycles.length > 0 ? { channels: [tableOf(cycles)], rate: context.sampleRate } : null;
};

export type DistributiveOmit<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;
