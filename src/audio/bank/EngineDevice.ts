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
 *
 * A chain's plan (INST-36.7) reloads keeping what it can: when devices are added to or removed from
 * the chain and the rest stay in order, the kept devices' nodes carry on in the new plan (carry.ts),
 * so tails ring on and held notes play on. With nothing crossfading, the change is made smooth here:
 * - **An added effect starts bypassed** and its bypass ramps to where it should be over the first
 *   block, so it fades in from the dry signal it passes through.
 * - **A removed effect is bypassed first,** and the plan without it loads a little later, once the
 *   bypass has ramped (live only; an offline render has no edits).
 * - **Effects that change order** are taken out and put back: bypassed before, started fresh in the
 *   new plan and faded in after, while the instrument and held notes play on. Carried, their state
 *   meets a different input all at once: an echo's buffer of resonator output, put back in front of
 *   the resonator, is resonated twice and comes out ten times as loud.
 */
import type { CompiledPlan } from "../definitions/compile";
import { carryWords } from "./carry";
import { chainEdit, ownerOf, type ChainEdit, type ChainLayout } from "./chainPlan";
import { engineValueOf } from "../definitions/values";
import { buildBanks } from "../dsp/wavetable";
import { loadSampleBuffer } from "../samples/builtinUrls";
import { BUILTIN_WAVETABLES, parseRef } from "../samples/catalog";
import { cyclesOf, tableOf } from "../samples/tables";
import { bindParams, type ParamBinding } from "../params/binding";
import type { ParamStore } from "../params/store";
import type { ParamValue } from "../params/types";
import type { SampleAudio } from "./bank";
import type { FromBank, ToBank } from "./messages";
import { mainInput, sidechainInput, takeSlot, type BankSlot } from "./pool";

/** Where a device's slot is: which stage of the signal flow, and audio to feed its input. */
export interface DevicePlace {
  /** The stage its bank serves (`takeSlot`): instruments 0, effects after what feeds them. */
  stage: number;
  /** What to play into the slot's input, for an effect. */
  input?: AudioNode;
  /** What to play into the slot's sidechain input: a keyed effect's key (INST-36.7 part 5). */
  sidechain?: AudioNode;
}

/**
 * Where each of a plan's params comes from: a store and the param's id there. One device's plan reads
 * its own store by the same ids; a chain's (INST-36.7) reads each device's store under its namespace.
 * A plan param with no source (a chain's bypass) is set with `setFixed`.
 */
export type ParamSources = Record<string, { store: ParamStore; id: string }>;

/** A single device's params: every param its plan reads, from `store` by the same id. */
export const storeParams = (plan: CompiledPlan, store: ParamStore): ParamSources =>
  Object.fromEntries(
    plan.params
      .filter((source) => store.has(source.param))
      .map((source) => [source.param, { store, id: source.param }]),
  );

/**
 * How long a removed or moved effect's bypass gets before the plan loads: its 20 ms ramp
 * (definitions/chain.ts) and time for the message to arrive.
 */
const FADE_OUT_MS = 40;

/** What was last sent to the bank, to work out what a reload keeps. */
interface Sent {
  plan: CompiledPlan;
  chain?: ChainLayout;
}

export class EngineDevice {
  /** The slot's output, once it arrives: silent until then. */
  readonly output: GainNode;
  readonly context: BaseAudioContext;
  private readonly input: AudioNode | undefined;
  private readonly sidechain: AudioNode | undefined;
  private slot: BankSlot | null = null;
  private waiting: ToBank[] = [];
  private unsubscribe: (() => void)[] = [];
  private disposed = false;
  private readonly arrived: Promise<void>;
  private plan: CompiledPlan;
  private sources: ParamSources;
  /** Values set directly rather than from a store, by plan param. */
  private readonly fixed = new Map<string, number>();
  /** Each sample param's latest sample, done once the bank has it. */
  private readonly samples = new Map<string, { ref: string; done: Promise<void> }>();
  /** What to call when the bank says it has dealt with a param's sample, by param and ref. */
  private readonly sampled = new Map<string, () => void>();
  /** Which devices the plan is made of, for a chain's. */
  private chain: ChainLayout | undefined;
  private sent: Sent | undefined;
  /** A reload waiting for removed effects to fade out. */
  private pending: ReturnType<typeof setTimeout> | undefined;

  constructor(
    context: BaseAudioContext,
    plan: CompiledPlan,
    sources: ParamSources,
    place: DevicePlace,
    chain?: ChainLayout,
  ) {
    this.context = context;
    this.input = place.input;
    this.sidechain = place.sidechain;
    this.output = new GainNode(context);
    this.plan = plan;
    this.sources = sources;
    this.chain = chain;
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
      this.sidechain?.connect(slot.node, 0, sidechainInput(slot.track));
      this.loadPlan();
      this.waiting.forEach((message) => slot.post({ ...message, track: slot.track } as ToBank));
      this.waiting = [];
      return heard;
    });
  }

  /**
   * Play another plan on the same slot, its params from `sources`: it crossfades in over a block,
   * and the notes held start again in it (INST-36.5). A chain's plan, given its `chain`, keeps the
   * state of the devices it keeps instead, if the edit allows (chainEdit).
   */
  reload(plan: CompiledPlan, sources: ParamSources, chain?: ChainLayout): void {
    this.plan = plan;
    this.sources = sources;
    this.chain = chain;
    if (!this.slot) return;
    clearTimeout(this.pending);
    this.pending = undefined;
    const before = this.sent?.chain;
    const edit = before && chain ? chainEdit(before.keys, chain.keys) : undefined;
    const fading = [...(edit?.removed ?? []), ...(edit?.moved ?? [])].flatMap((key) => before?.bypass.get(key) ?? []);
    // An offline context renders ahead without waiting, so there is no later to load at.
    if (fading.length === 0 || "startRendering" in this.context) {
      this.loadPlan(edit);
      return;
    }
    fading.forEach((param) => this.send({ type: "param", param, value: 1, time: this.context.currentTime }));
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.loadPlan(edit);
    }, FADE_OUT_MS);
  }

  /** How many samples late the plan's output is. */
  get latency(): number {
    return this.plan.latency;
  }

  /** Set a plan param no store holds (a chain's bypass), now and for every later plan. */
  setFixed(param: string, value: number): void {
    if (this.fixed.get(param) === value) return;
    this.fixed.set(param, value);
    this.send({ type: "param", param, value, time: this.context.currentTime });
  }

  /**
   * Send the plan with every param's value, and follow the stores from now on. With an `edit`, the
   * kept devices' nodes carry on from the plan sent before, and added effects fade in.
   */
  private loadPlan(edit?: ChainEdit): void {
    const { plan, sources, chain } = this;
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    const named = (sample: boolean) => [
      ...new Set(
        plan.params
          .filter((source) => !!source.sample === sample && sources[source.param])
          .map((source) => source.param),
      ),
    ];
    const tables = new Set(plan.params.filter((source) => source.wavetable).map((source) => source.param));
    const valueOf = (param: string, value: ParamValue) =>
      engineValueOf(sources[param].store.spec(sources[param].id), value);
    const values = {
      ...Object.fromEntries(this.fixed),
      ...Object.fromEntries(
        named(false).map((param) => [param, valueOf(param, sources[param].store.get(sources[param].id))]),
      ),
    };
    const before = this.sent;
    const keys = [...(before?.chain?.keys ?? []), ...(chain?.keys ?? [])];
    // Moved effects start fresh: an echo carried in front of a resonator holds the resonator's output,
    // and feeding it through again builds up tenfold. The instrument, among `moved` on any reorder,
    // keeps its state.
    const fresh = new Set((edit?.moved ?? []).filter((key) => chain?.bypass.has(key)));
    const carry =
      edit && before
        ? carryWords(before.plan, plan, (name) => {
            const owner = ownerOf(keys, name) ?? "";
            return edit.kept.has(owner) && !fresh.has(owner);
          })
        : undefined;
    // Added and moved effects start bypassed when anything carries, then ramp to their bypass as set.
    const from = carry
      ? Object.fromEntries(
          [...(edit?.added ?? []), ...(edit?.moved ?? [])]
            .flatMap((key) => chain?.bypass.get(key) ?? [])
            .map((param) => [param, 1]),
        )
      : {};
    this.send({ type: "load", plan, values, ...(carry ? { options: { carry, from } } : {}) });
    // Removed effects' bypass values go with them.
    (edit?.removed ?? []).forEach((key) => {
      const param = before?.chain?.bypass.get(key);
      if (param) this.fixed.delete(param);
    });
    this.sent = { plan, chain };
    // Bind each store's params, under the names the plan reads them by.
    const stores = new Set(Object.values(sources).map((source) => source.store));
    this.unsubscribe = [...stores].map((store) => {
      const mine = (sample: boolean) => named(sample).filter((param) => sources[param].store === store);
      const bindings: Record<string, ParamBinding> = Object.fromEntries([
        ...mine(false).map((param): [string, ParamBinding] => [
          sources[param].id,
          {
            apply: (value) =>
              this.send({ type: "param", param, value: valueOf(param, value), time: this.context.currentTime }),
          },
        ]),
        ...mine(true).map((param): [string, ParamBinding] => [
          sources[param].id,
          { apply: (value) => this.sendSample(param, String(value), tables.has(param)) },
        ]),
      ]);
      return bindParams(store, bindings);
    });
  }

  /** Resolves once the plan and its samples are with the engine, so an offline render doesn't start silent. */
  async ready(): Promise<void> {
    await this.arrived;
    await Promise.all([...this.samples.values()].map((sample) => sample.done));
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.pending);
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.unsubscribe = [];
    if (!this.slot) return;
    this.slot.node.disconnect(this.output, this.slot.track);
    this.input?.disconnect(this.slot.node, 0, mainInput(this.slot.track));
    this.sidechain?.disconnect(this.slot.node, 0, sidechainInput(this.slot.track));
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
