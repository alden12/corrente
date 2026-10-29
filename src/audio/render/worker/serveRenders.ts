/**
 * The render worker's side of the conversation (AGENT-4.9 part 3), wherever it runs: a browser Web
 * Worker (renderWorker.ts) or a Node worker thread on the hosted server (server/render/renderThread.ts).
 *
 * It rebuilds each project from its document (registering its custom devices, as a load does) and
 * renders it with `renderProject`; or draws one device's portrait (COMM-1.9.6). Samples and audio clips come from whoever asked for the render,
 * one request each as the render reaches them: the page decodes them in a browser, the server reads
 * them from storage.
 */
import { ProjectStore } from "../../project/projectStore";
import type { SampleAudio } from "../../bank/bank";
import { renderProject } from "../renderProject";
import { drawPortrait } from "../../portraits/devicePortrait";
import { buffersOf, type FromWorker, type LoadRequest, type ToWorker } from "./messages";

/** A worker's end of its channel to whoever asked: what both kinds of worker share. */
export interface WorkerPort {
  post(message: FromWorker, transfer?: ArrayBuffer[]): void;
  listen(handler: (message: ToWorker) => void): void;
}

export function serveRenders(port: WorkerPort): void {
  /** Requests waiting for their audio. */
  const waiting = new Map<number, (audio: SampleAudio | null) => void>();
  let nextRequest = 0;

  const ask = (id: number, what: LoadRequest["what"], ref: string) =>
    new Promise<SampleAudio | null>((resolve) => {
      const request = nextRequest++;
      waiting.set(request, resolve);
      port.post({ kind: "load", id, request, what, ref });
    });

  const handlers: { [Kind in ToWorker["kind"]]: (message: Extract<ToWorker, { kind: Kind }>) => void } = {
    render: ({ id, project, engine, sampleRate, options }) => {
      const store = new ProjectStore(false);
      store.load(project);
      const setup = {
        engine,
        sampleRate,
        loadSample: (ref: string) => ask(id, "sample", ref),
        loadAudio: (fileId: string) => ask(id, "audio", fileId),
      };
      renderProject(store, setup, options).then(
        (render) => port.post({ kind: "done", id, render }, buffersOf(render.channels)),
        (error: unknown) => port.post({ kind: "failed", id, message: String(error) }),
      );
    },
    portrait: ({ id, job, engine }) => {
      // Registered as a project registers them; devices register globally, but this is the worker's own world.
      const scratch = new ProjectStore(false);
      job.devices?.instruments?.forEach((device) => scratch.addCustomInstrument(device));
      job.devices?.effects?.forEach((device) => scratch.addCustomEffect(device));
      if (job.kind === "midi" && job.device) scratch.addCustomMidiDevice(job.device);
      drawPortrait(job, { engine, loadSample: (ref: string) => ask(id, "sample", ref) }).then(
        (portrait) => port.post({ kind: "drawn", id, portrait }),
        (error: unknown) => port.post({ kind: "failed", id, message: String(error) }),
      );
    },
    loaded: ({ request, audio }) => {
      waiting.get(request)?.(audio);
      waiting.delete(request);
    },
  };

  port.listen((message) => (handlers[message.kind] as (message: ToWorker) => void)(message));
}
