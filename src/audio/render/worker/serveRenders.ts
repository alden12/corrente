/**
 * The render worker's side of the conversation (AGENT-4.9 part 3), wherever it runs: a browser Web
 * Worker (renderWorker.ts) or a Node worker thread on the hosted server (server/render/renderThread.ts).
 *
 * It rebuilds each project from its document (registering its custom devices, as a load does) and
 * renders it with `renderProject`. Samples and audio clips come from whoever asked for the render,
 * one request each as the render reaches them: the page decodes them in a browser, the server reads
 * them from storage.
 */
import { ProjectStore } from "../../project/projectStore";
import type { SampleAudio } from "../../bank/bank";
import { renderProject } from "../renderProject";
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
    loaded: ({ request, audio }) => {
      waiting.get(request)?.(audio);
      waiting.delete(request);
    },
  };

  port.listen((message) => (handlers[message.kind] as (message: ToWorker) => void)(message));
}
