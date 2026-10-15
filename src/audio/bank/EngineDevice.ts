/**
 * A device on the new engine (INST-36.5): a chain's plan (chainPlan.ts: an instrument and the
 * engine effects after it, or a run of effects) on a track slot in an engine bank, its params kept in
 * step with their ParamStores. `EngineInstrument` plays notes on one and `EngineEffect` feeds audio
 * through one, both built on this, so tracks don't know which engine they're on while both exist.
 *
 * The slot arrives once the bank's worklet has loaded (the first time, the engine is fetched), so
 * whatever is sent before then waits and goes in order behind the plan. `ready` waits for the
 * worklet to say the plan is in, since an offline render outruns the messages that carry it.
 *
 * Sample params (INST-36.6) send their samples through deviceSamples.ts, and `ready` waits for those
 * too.
 *
 * A chain's plan (INST-36.7) reloads keeping what it can: when devices are added to or removed from
 * the chain and the rest stay in order, the kept devices' nodes carry on in the new plan (carry.ts),
 * so tails ring on and held notes play on. Added and moved effects fade in (reloadPlan.ts); a removed
 * or moved effect is bypassed first, and the plan loads a little later, once the bypass has ramped
 * (live only; an offline render has no edits).
 */
import type { ChainPlan } from "./chainPlan";
import { chainEdit, reloadOptions, type ChainEdit, type Sent } from "./reloadPlan";
import { DeviceSamples } from "./deviceSamples";
import { engineValueOf } from "../definitions/values";
import { bindParams, type ParamBinding } from "../params/binding";
import type { ParamValue } from "../params/types";
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
 * How long a removed or moved effect's bypass gets before the plan loads: its 20 ms ramp
 * (definitions/chain.ts) and time for the message to arrive.
 */
const FADE_OUT_MS = 40;

export class EngineDevice {
  /** The slot's output, once it arrives: silent until then. */
  readonly output: GainNode;
  readonly context: BaseAudioContext;
  /** What plays into the slot's input, for an effect. */
  private readonly feed: AudioNode | undefined;
  private readonly sidechain: AudioNode | undefined;
  private slot: BankSlot | null = null;
  private waiting: ToBank[] = [];
  private unsubscribe: (() => void)[] = [];
  private disposed = false;
  private readonly arrived: Promise<void>;
  /** The plan, which devices it's made of, and where its params come from. */
  private chain: ChainPlan;
  /** Values set directly rather than from a store, by plan param. */
  private readonly fixed = new Map<string, number>();
  private readonly samples: DeviceSamples;
  private sent: Sent | undefined;
  /** A reload waiting for removed effects to fade out. */
  private pending: ReturnType<typeof setTimeout> | undefined;
  /** Bypass params sent to 1 for that reload, until a plan loads. */
  private readonly fadingOut = new Set<string>();

  constructor(context: BaseAudioContext, chain: ChainPlan, place: DevicePlace) {
    this.context = context;
    this.feed = place.input;
    this.sidechain = place.sidechain;
    this.output = new GainNode(context);
    this.chain = chain;
    this.samples = new DeviceSamples(context, (message) => this.send({ type: "sample", ...message }));
    let loaded = () => {};
    const heard = new Promise<void>((resolve) => (loaded = resolve));
    const listener = (message: FromBank) => {
      if (message.type === "sampled") {
        if (message.message) console.error(message.message);
        this.samples.heard(message.param, message.ref);
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
      this.feed?.connect(slot.node, 0, mainInput(slot.track));
      this.sidechain?.connect(slot.node, 0, sidechainInput(slot.track));
      this.loadPlan();
      this.waiting.forEach((message) => slot.post({ ...message, track: slot.track } as ToBank));
      this.waiting = [];
      return heard;
    });
  }

  /** Each effect's bypass param in the plan, by effect id. */
  get bypass(): Map<string, string> {
    return this.chain.bypass;
  }

  /**
   * Play another chain's plan on the same slot. The devices it keeps carry on, if the edit allows
   * (chainEdit); otherwise it crossfades in over a block, and the notes held start again in it
   * (INST-36.5).
   */
  reload(chain: ChainPlan): void {
    this.chain = chain;
    if (!this.slot) return;
    clearTimeout(this.pending);
    this.pending = undefined;
    const before = this.sent?.chain;
    const edit = before ? chainEdit(before.keys, chain.keys) : undefined;
    const fading = [...(edit?.removed ?? []), ...(edit?.moved ?? [])].flatMap((key) => before?.bypass.get(key) ?? []);
    // An offline context renders ahead without waiting, so there is no later to load at.
    if (fading.length === 0 || "startRendering" in this.context) {
      this.loadPlan(edit);
      return;
    }
    fading.forEach((param) => {
      this.fadingOut.add(param);
      this.send({ type: "param", param, value: 1, time: this.context.currentTime });
    });
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.loadPlan(edit);
    }, FADE_OUT_MS);
  }

  /** How many samples late the plan's output is. */
  get latency(): number {
    return this.chain.plan.latency;
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
    const { chain } = this;
    const { plan, sources } = chain;
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
    const options = reloadOptions(before, plan, chain, edit, this.fadingOut);
    this.fadingOut.clear();
    this.send({ type: "load", plan, values, ...(Object.keys(options).length > 0 ? { options } : {}) });
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
          { apply: (value) => this.samples.request(param, String(value), tables.has(param)) },
        ]),
      ]);
      return bindParams(store, bindings);
    });
  }

  /** Resolves once the plan and its samples are with the engine, so an offline render doesn't start silent. */
  async ready(): Promise<void> {
    await this.arrived;
    await this.samples.ready();
  }

  dispose(): void {
    this.disposed = true;
    this.samples.dispose();
    clearTimeout(this.pending);
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.unsubscribe = [];
    if (!this.slot) return;
    this.slot.node.disconnect(this.output, this.slot.track);
    this.feed?.disconnect(this.slot.node, 0, mainInput(this.slot.track));
    this.sidechain?.disconnect(this.slot.node, 0, sidechainInput(this.slot.track));
    this.slot.release();
    this.slot = null;
  }

  /** Send a message for this device's track, or keep it until the slot arrives. */
  send(message: DistributiveOmit<ToBank, "track">): void {
    if (this.disposed) return;
    if (this.slot) this.slot.post({ ...message, track: this.slot.track } as ToBank);
    else this.waiting.push({ ...message, track: -1 } as ToBank);
  }
}

export type DistributiveOmit<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;
