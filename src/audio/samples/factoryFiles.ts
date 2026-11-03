/**
 * Browser-only: a factory sound's recordings (INST-55), fetched once and kept in the browser's cache
 * (the Cache API, so they're there offline too, and a file named by its hash never needs asking for
 * again), decoded by Web Audio and made 16-bit at once. Only the downloaded bytes are kept: decoded
 * audio goes to the engine and is gone from here, so a piano is never held twice.
 *
 * `factoryLoading` says how far each sound being fetched has got, for the UI.
 */
import type { ShortAudio } from "../bank/bank";
import { createValueStore } from "../../listeners";
import type { FactoryRegion } from "./factory";
import { DEFAULT_FACTORY_URL, factoryFileUrl, factoryMap, toShorts, type LoadFactoryFile } from "./factoryMap";
import type { SampleMap } from "../bank/bank";

const BASE = import.meta.env.VITE_FACTORY_URL || DEFAULT_FACTORY_URL;
const CACHE = "corrente-factory";

/** Each factory sound being fetched (by its id, `<set>/<sound>`): bytes so far, of how many. */
export const factoryLoading = createValueStore<Record<string, { loaded: number; total: number }>>({});

/** A file's bytes from the cache, or fetched and kept there. Without a cache (some private windows), just fetched. */
async function bytesOf(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null);
  const kept = await cache?.match(url);
  if (kept) return kept.arrayBuffer();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await cache?.put(url, response.clone()).catch(() => undefined);
  return response.arrayBuffer();
}

const browserFile =
  (context: BaseAudioContext): LoadFactoryFile =>
  async (region: FactoryRegion): Promise<ShortAudio> => {
    const buffer = await context.decodeAudioData(await bytesOf(factoryFileUrl(BASE, region)));
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) =>
      buffer.getChannelData(channel),
    );
    return { shorts: toShorts(channels), rate: buffer.sampleRate };
  };

/** The sample map for `factory:<id>`, fetched and decoded here, its progress in `factoryLoading`. */
export async function browserFactoryMap(context: BaseAudioContext, id: string): Promise<SampleMap | null> {
  const report = (loaded: number, total: number) =>
    factoryLoading.set({ ...factoryLoading.read(), [id]: { loaded, total } });
  try {
    return await factoryMap(id, browserFile(context), report);
  } finally {
    factoryLoading.set(Object.fromEntries(Object.entries(factoryLoading.read()).filter(([sound]) => sound !== id)));
  }
}
