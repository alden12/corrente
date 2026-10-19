/**
 * What a render needs in Node (AGENT-4.9): the committed engine.wasm, and samples read from disk.
 * The built-in kit is the app's own WAV files; uploaded samples ("asset:") aren't reachable from
 * here yet, so they load as none (the hosted server will read them from storage).
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BUILTIN_SAMPLES, parseRef } from "../../src/audio/samples/catalog";
import { decodeWav } from "../../src/audio/render/wav";
import type { LoadSample } from "../../src/audio/render/sampleAudio";
import type { RenderSetup } from "../../src/audio/render/renderDevice";
import type { SampleAudio } from "../../src/audio/bank/bank";

const ENGINE_URL = new URL("../../engine/engine.wasm", import.meta.url);
/** The built-in kit's files: `<id>.wav`, as builtinUrls.ts bundles them for the browser. */
const assetUrl = (id: string) => new URL(`../../src/audio/samples/assets/${id}.wav`, import.meta.url);

/** One decode per built-in, shared by every render. */
const builtins = new Map<string, Promise<SampleAudio | null>>();

export const loadNodeSample: LoadSample = (ref) => {
  const parsed = parseRef(ref);
  if (parsed.kind !== "builtin" || !BUILTIN_SAMPLES.some((sample) => sample.id === parsed.id))
    return Promise.resolve(null);
  const pending =
    builtins.get(parsed.id) ??
    readFile(fileURLToPath(assetUrl(parsed.id))).then(
      (bytes) => decodeWav(bytes),
      () => null,
    );
  builtins.set(parsed.id, pending);
  return pending;
};

let engine: Buffer | undefined;

/** The render setup for this process: the engine read once, samples from disk. */
export const nodeRenderSetup = (): RenderSetup => {
  engine ??= readFileSync(fileURLToPath(ENGINE_URL));
  return { engine, loadSample: loadNodeSample };
};
