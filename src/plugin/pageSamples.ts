/**
 * Where the plugin window's packages get their samples (PLUGIN-3.2): a built-in's file as the app
 * bundles it, and a wavetable's table made as the app makes it. A sample of your own isn't here yet
 * (the webview's storage, a later part), so it plays silence.
 */
import type { PackageSamples } from "../audio/bank/devicePackage";
import { browserSample } from "../audio/bank/deviceSamples";
import { sampleAudioFor } from "../audio/render/sampleAudio";
import { parseRef } from "../audio/samples/catalog";
import { BUILTIN_URLS } from "../audio/samples/builtinUrls";

/** The rate a table is made at: it is read by the cycle, so any rate plays it the same. */
const TABLE_RATE = 48000;

/** A context only for decoding, made the first time a table needs a sample decoded. */
let decoder: OfflineAudioContext | undefined;
const decoderContext = () => (decoder ??= new OfflineAudioContext(1, 1, TABLE_RATE));

export const pageSamples: PackageSamples = {
  file: async (ref) => {
    const parsed = parseRef(ref);
    const url = parsed.kind === "builtin" ? BUILTIN_URLS[parsed.id] : undefined;
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  },
  table: async (ref) =>
    (await sampleAudioFor(ref, true, browserSample(decoderContext()), TABLE_RATE))?.channels[0] ?? null,
};
