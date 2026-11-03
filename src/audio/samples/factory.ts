/**
 * The factory sample sets (INST-55): sampled instruments too big for the app bundle, each sound a
 * sample map whose recordings load on first use from the public `factory/` files (`factoryUrl`), named
 * by their SHA-256 so a browser keeps them for good. The maps are made by `yarn factory:import` from
 * openly licensed libraries (scripts/factory/sets.ts) and committed in `sets/`. Pure data, so the
 * MCP and the Node renderer read it too.
 *
 * A sound's ref is `factory:<set>/<sound>`, e.g. `factory:salamander/grand`.
 */
import salamander from "./sets/salamander.json";
import type { ParamSchema } from "../params/types";

/** One recording of a sound, and the keys and velocities it plays (SFZ's terms, as `SampleRegion`). */
export interface FactoryRegion {
  /** The FLAC's SHA-256: its file is `<file>.flac`. */
  file: string;
  frames: number;
  channels: number;
  rate: number;
  /** The FLAC's size, for showing a download's progress. */
  bytes: number;
  lokey: number;
  hikey: number;
  lovel: number;
  hivel: number;
  keycenter: number;
}

export interface FactorySound {
  id: string;
  name: string;
  regions: FactoryRegion[];
}

export interface FactorySet {
  id: string;
  name: string;
  licence: string;
  credit: string;
  /** Where the recordings came from, at the commit they were taken at. */
  source: string;
  sounds: FactorySound[];
}

export const FACTORY_SETS: FactorySet[] = [salamander];

export const FACTORY_PREFIX = "factory:";

export const factoryRef = (set: string, sound: string): string => `${FACTORY_PREFIX}${set}/${sound}`;

/** The sound a `factory:` ref's id (`<set>/<sound>`) names, if there is one. */
export function factorySound(id: string): FactorySound | undefined {
  const [setId, soundId] = id.split("/");
  return FACTORY_SETS.find((set) => set.id === setId)?.sounds.find((sound) => sound.id === soundId);
}

/** What a sound costs: bytes to download (once), and bytes it takes in the engine (16-bit). */
export const soundSize = (sound: FactorySound): { download: number; memory: number } => {
  // A recording two of its regions share counts once.
  const files = new Map(sound.regions.map((region) => [region.file, region]));
  return {
    download: [...files.values()].reduce((sum, region) => sum + region.bytes, 0),
    memory: [...files.values()].reduce((sum, region) => sum + region.frames * region.channels * 2, 0),
  };
};

/** Every factory sound, with what it costs in megabytes: what the pickers and the MCP list. */
export const FACTORY_SOUNDS = FACTORY_SETS.flatMap((set) =>
  set.sounds.map((sound) => {
    const { download, memory } = soundSize(sound);
    return {
      ref: factoryRef(set.id, sound.id),
      name: sound.name,
      set: set.name,
      downloadMB: Math.round(download / 1e5) / 10,
      memoryMB: Math.round(memory / 1e5) / 10,
    };
  }),
);

/** Whether a patch's sound plays a factory sample: one the first use downloads. */
export const usesFactorySamples = (params: Record<string, unknown>): boolean =>
  Object.values(params).some((value) => typeof value === "string" && value.startsWith(FACTORY_PREFIX));

/** Whether a device plays a factory sample as it starts (the Grand Piano does): its defaults are its sound. */
export const defaultsUseFactorySamples = (schema: ParamSchema): boolean =>
  usesFactorySamples(Object.fromEntries(schema.map((spec) => [spec.id, spec.default])));
