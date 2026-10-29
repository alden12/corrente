/**
 * The plugin window's half of the plugin (PLUGIN-3.2): a one-track project whose device rack you edit,
 * turned into what the plugin plays. DOM-free: the page passes in how it reads samples and how it
 * reaches the plugin, so tests drive it with neither.
 *
 * - **A new device** (another instrument, an effect added or removed, a sample swapped) is a package
 *   (devicePackage.ts), sent as `load`. The plugin builds it off the audio thread and swaps it in.
 * - **A knob** is `value`: the binding value's number and its engine value, set between blocks with
 *   no rebuild, as the worklet's param messages are. So is an effect's bypass.
 * - **The project** is sent as `rack`, a moment after the last change, for the plugin to save with the
 *   host's project and hand back when the window opens again.
 * - **A macro the host moves** (`fromHost`) sets the param it's mapped to here, so the knob follows,
 *   and isn't sent back (PLUGIN-3.4).
 *
 * Only what the instrument's plan takes in plays: effects after a non-engine one aren't played yet.
 */
import { absorbedKey, instrumentChain, type InstrumentChain } from "../audio/bank/chainPlan";
import { bindingOf } from "../audio/bank/binding";
import { devicePackage, type DevicePackage, type PackageSamples } from "../audio/bank/devicePackage";
import { engineValueOf } from "../audio/definitions/values";
import { catalogEntry } from "../audio/instruments/catalog";
import { migrateDocument, PROJECT_SCHEMA } from "../audio/project/documentMigration";
import { projectDataSchema, type ProjectData } from "../audio/project/schema";
import type { ParamStore } from "../audio/params/store";
import { createListeners } from "../listeners";
import type { InstrumentTrack, ProjectStore } from "../audio/project/projectStore";
import { paramTitle } from "./paramTitle";
import { positionOf, valueAt } from "./pluginMacros";

/** What the page sends the plugin (editor.rs's `Message`). */
export type ToPlugin =
  | { type: "ready" }
  | { type: "load"; package: string }
  /** A sound being tried in Explore, played instead of the track's until null ends it; never saved. */
  | { type: "preview"; package: string | null }
  | { type: "value"; value: number; raw: number }
  | { type: "rack"; rack: string }
  /** What each macro is mapped to, by binding name (`pluginMacros.ts`). */
  | { type: "macros"; slots: (string | null)[] }
  /** Hand the keyboard back to the host, which plays notes from it (`keysToHost.ts`). */
  | { type: "keys" }
  /** A key of the window's keys went down (a velocity above 0) or up (0), PLUGIN-3.11. */
  | { type: "note"; note: number; velocity: number }
  /** Is a newer build of this page ready (`pageUpdates.ts`)? And reopen the page on it. */
  | { type: "update" }
  | { type: "reload" }
  /** Open a web address in the system's browser: the window can't follow a link itself. */
  | { type: "open"; url: string }
  | { type: "log"; text: string };

/** The project as the plugin saves it: with its schema version, so a later page can upcast it. */
interface SavedRack {
  version: number;
  project: unknown;
}

/** How long after the last change the project is sent to be saved. */
const RACK_DELAY_MS = 500;

/** The track the rack edits: the project's first, if it's an instrument track. */
const trackOf = (project: ProjectStore): InstrumentTrack | undefined => {
  const track = project.getTracks()[0];
  return track?.kind === "instrument" ? track : undefined;
};

/**
 * A saved rack as project data, upcast to this page's schema and checked against it; undefined for
 * one it can't read (the window then starts afresh).
 */
export const projectOfRack = (rack: string): ProjectData | undefined => {
  try {
    const saved = JSON.parse(rack) as SavedRack;
    const migrated = migrateDocument(saved.project, saved.version, PROJECT_SCHEMA);
    if (migrated.version !== PROJECT_SCHEMA) return undefined;
    const parsed = projectDataSchema.safeParse(migrated.data);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** The project as `rack` sends it. */
export const rackOf = (project: ProjectStore): string =>
  JSON.stringify({ version: PROJECT_SCHEMA, project: project.snapshot() } satisfies SavedRack);

/** The bypass values the plan's effects are at now, by the plan's param name. */
const fixedOf = (chain: InstrumentChain): Record<string, number> =>
  Object.fromEntries(
    chain.absorbed.flatMap((effect) => {
      const param = chain.plan.bypass.get(effect.id);
      return param ? [[param, effect.bypassed ? 1 : 0]] : [];
    }),
  );

/** A chain's package, its samples read in, labelled as its instrument. */
const packageOf = (chain: InstrumentChain, instrumentType: string, samples: PackageSamples): Promise<DevicePackage> =>
  devicePackage(chain.plan, catalogEntry(instrumentType).label, samples, paramTitle, fixedOf(chain));

/** What a track plays, as a package; undefined for a track with no instrument to play. */
export const trackPackage = (track: InstrumentTrack, samples: PackageSamples): Promise<DevicePackage> | undefined => {
  const chain = instrumentChain(track.instrumentType, track.params, track.effects);
  return chain && packageOf(chain, track.instrumentType, samples);
};

export class PluginDevice {
  private readonly project: ProjectStore;
  private readonly samples: PackageSamples;
  private readonly send: (message: ToPlugin) => void;
  /** The chain playing, and what makes it this device rather than another. */
  private chain: InstrumentChain | undefined;
  private key = "";
  /** The engine value each binding value was last sent at; undefined for a sample. */
  private sent: (number | undefined)[] = [];
  /** Counts packages started, so one that finishes after a newer one started is dropped; 0 when none is. */
  private building = 0;
  private pending: Promise<void> = Promise.resolve();
  private unsubscribeStores: (() => void)[] = [];
  private rackTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set while a host's move is being taken, so the values it changes are noted but not sent back. */
  private fromHostNow = false;
  /** Hears the device change: another chain, so other params to map. */
  private readonly listeners = createListeners();

  constructor(project: ProjectStore, samples: PackageSamples, send: (message: ToPlugin) => void) {
    this.project = project;
    this.samples = samples;
    this.send = send;
  }

  /** Send the device now, and keep sending its changes. Returns what stops it. */
  start(): () => void {
    const unsubscribe = this.project.subscribe(() => this.projectChanged());
    this.projectChanged();
    return () => {
      unsubscribe();
      this.unsubscribeStores.forEach((stop) => stop());
      clearTimeout(this.rackTimer);
    };
  }

  /** Resolves once the package being built (if any) is sent: for tests. */
  async settled(): Promise<void> {
    await this.pending;
  }

  subscribe = this.listeners.subscribe;

  /** What makes the device this one rather than another; changes as `subscribe` hears. */
  deviceKey = (): string => this.key;

  /** The binding names of the device's params, in its order (a package's param values): what macros map. */
  paramNames(): string[] {
    const chain = this.chain;
    if (!chain) return [];
    const binding = bindingOf(chain.plan.plan);
    return binding.names.filter((name, index) => chain.plan.sources[name] && !binding.samples[index]);
  }

  /** The binding name of `store`'s param `id`, if the device plays it as a param. */
  nameOf(store: ParamStore, id: string): string | undefined {
    const sources = this.chain?.plan.sources ?? {};
    return this.paramNames().find((name) => sources[name]?.store === store && sources[name].id === id);
  }

  /** Where `name` is, and its spec: to show it, or set it. */
  paramOf(name: string): { store: ParamStore; id: string } | undefined {
    return this.chain?.plan.sources[name];
  }

  /**
   * The host moved the macro mapped to `name` to `position`: set the param to match, so its knob
   * follows, unless it's there already (a move the window made, coming back). Not sent back.
   */
  fromHost(name: string, position: number): void {
    const source = this.paramOf(name);
    if (!source) return;
    const spec = source.store.spec(source.id);
    const now = positionOf(spec, source.store.get(source.id));
    const value = valueAt(spec, position);
    if (value === undefined || (now !== undefined && Math.abs(now - position) < 1e-4)) return;
    this.fromHostNow = true;
    try {
      source.store.set(source.id, value);
    } finally {
      this.fromHostNow = false;
    }
  }

  private projectChanged(): void {
    this.saveRackSoon();
    const track = trackOf(this.project);
    const chain = track && instrumentChain(track.instrumentType, track.params, track.effects);
    // An empty track plays nothing new: the plugin keeps what it had until an instrument is picked.
    if (!track || !chain) return;
    const key = `${track.instrumentType}|${absorbedKey(chain.absorbed)}`;
    if (key !== this.key) {
      this.key = key;
      this.chain = chain;
      this.listenToStores(chain);
      this.sendPackage();
      this.listeners.emit();
    } else {
      // Same device: what can change without a store hearing it is an effect's bypass.
      this.chain = chain;
      this.sendValues();
    }
  }

  /** Hear each store the plan reads, for knobs (values) and samples (a new package). */
  private listenToStores({ plan }: InstrumentChain): void {
    this.unsubscribeStores.forEach((stop) => stop());
    const binding = bindingOf(plan.plan);
    const stores = new Set(Object.values(plan.sources).map((source) => source.store));
    this.unsubscribeStores = [...stores].map((store) =>
      store.subscribe((id) => {
        this.saveRackSoon();
        const names = binding.names.filter(
          (name) => plan.sources[name]?.store === store && plan.sources[name].id === id,
        );
        if (names.some((name) => binding.samples[binding.numbers.get(name) ?? -1])) this.sendPackage();
        else if (names.length > 0) this.sendValues();
      }),
    );
  }

  /** Each binding value's engine value now, undefined for a sample. */
  private values(chain: InstrumentChain): (number | undefined)[] {
    const { plan, sources } = chain.plan;
    const binding = bindingOf(plan);
    const fixed = fixedOf(chain);
    return binding.names.map((name, index) => {
      if (binding.samples[index]) return undefined;
      const source = sources[name];
      return source ? engineValueOf(source.store.spec(source.id), source.store.get(source.id)) : (fixed[name] ?? 0);
    });
  }

  /** Send each value that moved since it was last sent. Waits while a package is being built. */
  private sendValues(): void {
    const chain = this.chain;
    if (!chain || this.building > 0) return;
    this.values(chain).forEach((raw, value) => {
      if (raw === undefined || Object.is(raw, this.sent[value])) return;
      this.sent[value] = raw;
      if (!this.fromHostNow) this.send({ type: "value", value, raw });
    });
  }

  /** Build the chain's package (its samples read in) and send it, then any value moved meanwhile. */
  private sendPackage(): void {
    const chain = this.chain;
    if (!chain) return;
    const build = ++this.building;
    this.pending = packageOf(chain, trackOf(this.project)?.instrumentType ?? "", this.samples)
      .then((made: DevicePackage) => {
        if (build !== this.building) return;
        this.sent = made.values.map((value) => (value.kind === "sample" ? undefined : value.raw));
        this.send({ type: "load", package: JSON.stringify(made) });
      })
      .catch((error: unknown) => this.send({ type: "log", text: `the device didn't package: ${String(error)}` }))
      .finally(() => {
        if (build !== this.building) return;
        this.building = 0;
        this.sendValues();
      });
  }

  private saveRackSoon(): void {
    clearTimeout(this.rackTimer);
    this.rackTimer = setTimeout(() => this.send({ type: "rack", rack: rackOf(this.project) }), RACK_DELAY_MS);
  }
}
