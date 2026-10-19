/**
 * The page's side of the render worker (AGENT-4.9 part 3b): render a project on the engine render
 * core off the main thread, and measure it. This is what the in-app agent's `analyze_mix` hears,
 * and what an export will run on (DAW-13).
 *
 * The worker gets the project's document and the engine's bytes; when it reaches a sample or an
 * audio clip it asks for it, and it's decoded here (Web Audio, at the render's rate) and handed over
 * (renderClient.ts).
 */
import { fetchEngine } from "../bank/pool";
import { browserAudio, browserSample } from "../bank/deviceSamples";
import { setSampleAssets } from "../samples/sampleRegistry";
import { analyzeRender, summarizeMix, type MixSummary } from "../analysis/analyze";
import type { ProjectStore } from "../project/projectStore";
import type { ProjectRender, ProjectRenderOptions } from "../render/renderProject";
import type { FromWorker } from "../render/worker/messages";
import { renderClient } from "../render/worker/renderClient";

const DEFAULT_RATE = 48000;

const render = renderClient(() => {
  const worker = new Worker(new URL("../render/worker/renderWorker.ts", import.meta.url), { type: "module" });
  return {
    post: (message, transfer = []) => worker.postMessage(message, transfer),
    listen: (handler) => (worker.onmessage = ({ data }: MessageEvent<FromWorker>) => handler(data)),
    onFail: (handler) => (worker.onerror = (event) => handler(new Error(event.message || "the render worker failed"))),
    terminate: () => worker.terminate(),
  };
});

/** Render a project's arrangement on the engine render core, in the render worker. */
export async function renderProjectInWorker(
  project: ProjectStore,
  { sampleRate = DEFAULT_RATE, ...options }: ProjectRenderOptions & { sampleRate?: number } = {},
): Promise<ProjectRender> {
  setSampleAssets(project.getSamples()); // so a Sampler's "asset:<id>" ref resolves
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  return render({
    project: project.snapshot(),
    engine: (await fetchEngine()).slice(0),
    sampleRate,
    options,
    load: { sample: browserSample(decoder), audio: browserAudio(decoder) },
  });
}

/**
 * Render the project and measure it: the agent's ears as one call, what `analyze_mix` runs. It
 * hears the audio the user would, so the agent can check its edits (clipping, level, loudness).
 */
export async function analyzeProjectMix(project: ProjectStore): Promise<MixSummary> {
  return summarizeMix(analyzeRender(await renderProjectInWorker(project)));
}
