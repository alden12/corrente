/**
 * The page's side of the render worker (AGENT-4.9 part 3b): render a project on the engine render
 * core off the main thread, and measure it. This is what the in-app agent's `analyze_mix` hears,
 * and what an export will run on (DAW-13).
 *
 * The worker gets the project's document and the engine's bytes; when it reaches a sample or an
 * audio clip it asks for it, and it's decoded here (Web Audio, at the render's rate) and handed over.
 * One worker serves every render, made on first use.
 */
import { fetchEngine } from "../bank/pool";
import { browserAudio, browserSample } from "../bank/deviceSamples";
import { setSampleAssets } from "../samples/sampleRegistry";
import { analyzeRender, summarizeMix, type MixSummary } from "../analysis/analyze";
import type { ProjectStore } from "../project/projectStore";
import type { SampleAudio } from "../bank/bank";
import type { ProjectRender, ProjectRenderOptions } from "../render/renderProject";
import { buffersOf, type FromWorker, type ToWorker } from "../render/worker/messages";

const DEFAULT_RATE = 48000;

/** A render waiting on the worker: how to load what it asks for, and how to answer. */
interface Pending {
  load: {
    sample: (ref: string) => Promise<SampleAudio | null>;
    audio: (fileId: string) => Promise<SampleAudio | null>;
  };
  resolve: (render: ProjectRender) => void;
  reject: (error: Error) => void;
}

const pending = new Map<number, Pending>();
let nextId = 0;
let worker: Worker | null = null;

const post = (message: ToWorker, transfer: ArrayBuffer[] = []) => worker!.postMessage(message, transfer);

const HANDLERS: { [Kind in FromWorker["kind"]]: (message: Extract<FromWorker, { kind: Kind }>) => void } = {
  load: ({ id, request, what, ref }) => {
    const render = pending.get(id);
    const loading = render ? render.load[what](ref) : Promise.resolve(null);
    void loading
      .catch(() => null)
      .then((audio) => post({ kind: "loaded", request, audio }, audio ? buffersOf(audio.channels) : []));
  },
  done: ({ id, render }) => {
    pending.get(id)?.resolve(render);
    pending.delete(id);
  },
  failed: ({ id, message }) => {
    pending.get(id)?.reject(new Error(message));
    pending.delete(id);
  },
};

const workerReady = (): Worker => {
  if (worker) return worker;
  worker = new Worker(new URL("../render/worker/renderWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<FromWorker>) =>
    (HANDLERS[data.kind] as (message: FromWorker) => void)(data);
  // A worker that fails outright fails every render waiting on it; the next render makes a new one.
  worker.onerror = (event) => {
    pending.forEach(({ reject }) => reject(new Error(event.message || "the render worker failed")));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
};

/** Render a project's arrangement on the engine render core, in the render worker. */
export async function renderProjectInWorker(
  project: ProjectStore,
  { sampleRate = DEFAULT_RATE, ...options }: ProjectRenderOptions & { sampleRate?: number } = {},
): Promise<ProjectRender> {
  const engine = (await fetchEngine()).slice(0);
  setSampleAssets(project.getSamples()); // so a Sampler's "asset:<id>" ref resolves
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  workerReady();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { load: { sample: browserSample(decoder), audio: browserAudio(decoder) }, resolve, reject });
    post({ kind: "render", id, project: project.snapshot(), engine, sampleRate, options }, [engine]);
  });
}

/**
 * Render the project and measure it: the agent's ears as one call, what `analyze_mix` runs. It
 * hears the audio the user would, so the agent can check its edits (clipping, level, loudness).
 */
export async function analyzeProjectMix(project: ProjectStore): Promise<MixSummary> {
  return summarizeMix(analyzeRender(await renderProjectInWorker(project)));
}
