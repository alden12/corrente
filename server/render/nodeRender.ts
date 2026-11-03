/**
 * What a render needs in Node (AGENT-4.9): the committed engine.wasm, and samples read from disk.
 * The built-in kit is the app's own WAV files. A project's own samples and audio clips live wherever
 * the project is stored, so `storedAudio` loads them through a reader its caller gives.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BUILTIN_SAMPLES, parseRef } from "../../src/audio/samples/catalog";
import { decodeWav } from "../../src/audio/render/wav";
import type { LoadAudio, LoadSample } from "../../src/audio/render/sampleAudio";
import type { SampleAsset } from "../../src/audio/samples/catalog";
import type { RenderSetup } from "../../src/audio/render/renderDevice";
import type { SampleAudio } from "../../src/audio/bank/bank";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import {
  DEFAULT_FACTORY_URL,
  factoryFileUrl,
  factoryMap,
  toShorts,
  type LoadFactoryFile,
} from "../../src/audio/samples/factoryMap";

const ENGINE_URL = new URL("../../engine/engine.wasm", import.meta.url);
/** The built-in kit's files: `<id>.wav`, as builtinUrls.ts bundles them for the browser. */
export const builtinSampleUrl = (id: string) => new URL(`../../src/audio/samples/assets/${id}.wav`, import.meta.url);

/** One decode per built-in, shared by every render. */
const builtins = new Map<string, Promise<SampleAudio | null>>();

/**
 * Where the factory samples are for this process (INST-55): `FACTORY_URL`, else corrente.cloud's. A
 * folder rather than an address reads them from disk: `yarn portraits` before they're uploaded.
 */
const FACTORY_URL = process.env.FACTORY_URL || DEFAULT_FACTORY_URL;
const factoryFetch = (url: string): Promise<Uint8Array> =>
  url.includes("://")
    ? fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      })
    : readFile(url);
/** Factory files' bytes by hash, fetched once a process: a few MB a sound, and they never change. */
const factoryBytes = new Map<string, Promise<Uint8Array>>();

/** A factory recording, fetched (once) and decoded to 16-bit. */
const nodeFactoryFile: LoadFactoryFile = async (region) => {
  const pending = factoryBytes.get(region.file) ?? factoryFetch(factoryFileUrl(FACTORY_URL, region));
  factoryBytes.set(region.file, pending);
  const bytes = await pending.catch((error: unknown) => {
    factoryBytes.delete(region.file);
    throw error;
  });
  const decoder = new FLACDecoder();
  await decoder.ready;
  try {
    const { channelData, sampleRate } = await decoder.decodeFile(bytes);
    return { shorts: toShorts(channelData), rate: sampleRate };
  } finally {
    decoder.free();
  }
};

export const loadNodeSample: LoadSample = (ref) => {
  const parsed = parseRef(ref);
  if (parsed.kind === "factory") return factoryMap(parsed.id, nodeFactoryFile);
  if (parsed.kind !== "builtin" || !BUILTIN_SAMPLES.some((sample) => sample.id === parsed.id))
    return Promise.resolve(null);
  const pending =
    builtins.get(parsed.id) ??
    readFile(fileURLToPath(builtinSampleUrl(parsed.id))).then(
      (bytes) => decodeWav(bytes),
      () => null,
    );
  builtins.set(parsed.id, pending);
  return pending;
};

let engine: Buffer | undefined;
const engineBytes = () => (engine ??= readFileSync(fileURLToPath(ENGINE_URL)));

/** The render setup for this process: the engine read once, samples from disk. */
export const nodeRenderSetup = (): RenderSetup => ({ engine: engineBytes(), loadSample: loadNodeSample });

/** The engine's bytes as a copy of its own, to hand to a worker thread (which takes them). */
export const engineCopy = (): ArrayBuffer => {
  const bytes = engineBytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/** Decoded stored files by content hash, shared by every render; the oldest go past this many. */
const STORED_KEPT = 64;
const stored = new Map<string, Promise<SampleAudio | null>>();

/**
 * A project's own samples and audio clips, read by content hash with `read` and decoded once. Only
 * WAV can be decoded here for now (recordings are WAV; an imported MP3 or the like loads as none, and
 * the render says so).
 */
export const storedAudio = (
  assets: readonly SampleAsset[],
  read: (contentHash: string) => Promise<Uint8Array | null>,
): { sample: LoadSample; audio: LoadAudio } => {
  const byHash: LoadAudio = (contentHash) => {
    const pending =
      stored.get(contentHash) ??
      read(contentHash).then(
        (bytes) => (bytes ? decodeWav(bytes) : null),
        () => null,
      );
    stored.delete(contentHash);
    stored.set(contentHash, pending);
    if (stored.size > STORED_KEPT) stored.delete(stored.keys().next().value!);
    return pending.catch(() => null);
  };
  return {
    sample: (ref) => {
      const parsed = parseRef(ref);
      if (parsed.kind !== "asset") return loadNodeSample(ref);
      const asset = assets.find((entry) => entry.id === parsed.id);
      return asset ? byHash(asset.contentHash) : Promise.resolve(null);
    },
    audio: byHash,
  };
};
