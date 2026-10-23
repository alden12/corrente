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
import type { InstrumentTrack, ProjectStore } from "../audio/project/projectStore";
import { paramTitle } from "./paramTitle";

/** What the page sends the plugin (editor.rs's `Message`). */
export type ToPlugin =
  | { type: "ready" }
  | { type: "load"; package: string }
  | { type: "value"; value: number; raw: number }
  | { type: "rack"; rack: string }
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

  /** The bypass values the plan's effects are at now, by the plan's param name. */
  private fixed(chain: InstrumentChain): Record<string, number> {
    return Object.fromEntries(
      chain.absorbed.flatMap((effect) => {
        const param = chain.plan.bypass.get(effect.id);
        return param ? [[param, effect.bypassed ? 1 : 0]] : [];
      }),
    );
  }

  /** Each binding value's engine value now, undefined for a sample. */
  private values(chain: InstrumentChain): (number | undefined)[] {
    const { plan, sources } = chain.plan;
    const binding = bindingOf(plan);
    const fixed = this.fixed(chain);
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
      this.send({ type: "value", value, raw });
    });
  }

  /** Build the chain's package (its samples read in) and send it, then any value moved meanwhile. */
  private sendPackage(): void {
    const chain = this.chain;
    if (!chain) return;
    const build = ++this.building;
    const label = catalogEntry(trackOf(this.project)?.instrumentType ?? "").label;
    this.pending = devicePackage(chain.plan, label, this.samples, paramTitle, this.fixed(chain))
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
