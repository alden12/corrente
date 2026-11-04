/**
 * A factory sound as the engine plays it (INST-55): its recordings fetched and decoded, a few at a
 * time, straight into 16-bit audio, and put in a sample map. How a file is fetched and decoded is the
 * caller's (the browser's Web Audio and cache, or Node's decoder): what's made of it is shared here.
 * DOM-free, so the Node renderer uses it too.
 */
import type { SampleMap, ShortAudio } from "../bank/bank";
import { factorySound, soundSize, type FactoryRegion } from "./factory";

/** Where the factory files are, unless a build or server says otherwise. */
export const DEFAULT_FACTORY_URL = "https://corrente.cloud/factory";

export const factoryFileUrl = (base: string, region: FactoryRegion): string => `${base}/${region.file}.flac`;

/** One recording, fetched and decoded; null if it won't load. */
export type LoadFactoryFile = (region: FactoryRegion) => Promise<ShortAudio | null>;

/** How much of a sound has loaded so far, in bytes, of how much it needs. */
export type FactoryProgress = (loaded: number, total: number) => void;

/** Recordings fetched and decoded at once: enough to keep a connection busy, few enough to hold. */
const AT_ONCE = 4;

/**
 * Decoded floats as 16-bit whole numbers, rounded, past full scale held at it: up to two channels. A
 * loop, not `Int16Array.from` with a function per sample: the full piano is ~49 million samples, which
 * took 2.2 s that way in Chromium and 0.1 s this way, every time the app opens.
 */
export const toShorts = (channels: Float32Array[]): Int16Array[] =>
  channels.slice(0, 2).map((channel) => {
    const shorts = new Int16Array(channel.length);
    for (let index = 0; index < channel.length; index++) {
      const value = Math.round(channel[index] * 32768);
      shorts[index] = value > 32767 ? 32767 : value < -32768 ? -32768 : value;
    }
    return shorts;
  });

/**
 * The sample map for `factory:<id>`, or null for no such sound, or one whose recordings didn't all
 * load (a piano missing notes would be worse than a silent one, and says so).
 */
export async function factoryMap(
  id: string,
  load: LoadFactoryFile,
  progress?: FactoryProgress,
): Promise<SampleMap | null> {
  const sound = factorySound(id);
  if (!sound) return null;
  // Each recording once: two regions may share one.
  const files = [...new Map(sound.regions.map((region) => [region.file, region])).values()];
  const total = soundSize(sound).download;
  const loaded = new Map<string, ShortAudio | null>();
  let bytes = 0;
  progress?.(0, total);
  for (let start = 0; start < files.length; start += AT_ONCE) {
    const batch = files.slice(start, start + AT_ONCE);
    const audio = await Promise.all(
      batch.map(async (region) => {
        const decoded = await load(region).catch(() => null);
        bytes += region.bytes;
        progress?.(bytes, total);
        return decoded;
      }),
    );
    batch.forEach((region, index) => loaded.set(region.file, audio[index]));
  }
  if ([...loaded.values()].some((audio) => audio === null)) return null;
  return {
    regions: sound.regions.map((region) => ({
      ref: `factory-file:${region.file}`,
      audio: loaded.get(region.file)!,
      lokey: region.lokey,
      hikey: region.hikey,
      lovel: region.lovel,
      hivel: region.hivel,
      keycenter: region.keycenter,
    })),
  };
}
