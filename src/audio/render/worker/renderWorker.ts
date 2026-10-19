/**
 * The engine render core in a Web Worker (AGENT-4.9 part 3b): a project rendered off the main
 * thread, so the page keeps playing and drawing while the agent listens or a song exports.
 *
 * It rebuilds the project from its document (registering its custom devices, as a load does) and
 * renders it with `renderProject`. Samples and audio clips come from the page, which decodes them
 * (a worker has no Web Audio), one request each as the render reaches them.
 */
import { ProjectStore } from "../../project/projectStore";
import type { SampleAudio } from "../../bank/bank";
import { renderProject } from "../renderProject";
import { buffersOf, type FromWorker, type LoadRequest, type ToWorker } from "./messages";

/** The worker's side of its port, typed here since the app's types are the page's (DOM), not a worker's. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: ArrayBuffer[]): void;
};

/** Requests to the page waiting for their audio. */
const waiting = new Map<number, (audio: SampleAudio | null) => void>();
let nextRequest = 0;

const ask = (id: number, what: LoadRequest["what"], ref: string) =>
  new Promise<SampleAudio | null>((resolve) => {
    const request = nextRequest++;
    waiting.set(request, resolve);
    scope.postMessage({ kind: "load", id, request, what, ref });
  });

const HANDLERS: { [Kind in ToWorker["kind"]]: (message: Extract<ToWorker, { kind: Kind }>) => void } = {
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
      (render) => scope.postMessage({ kind: "done", id, render }, buffersOf(render.channels)),
      (error: unknown) => scope.postMessage({ kind: "failed", id, message: String(error) }),
    );
  },
  loaded: ({ request, audio }) => {
    waiting.get(request)?.(audio);
    waiting.delete(request);
  },
};

scope.onmessage = ({ data }) => (HANDLERS[data.kind] as (message: ToWorker) => void)(data);
