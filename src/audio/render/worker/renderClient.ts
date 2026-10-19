/**
 * The asking side of the render worker (AGENT-4.9 part 3), shared by the page (a Web Worker) and the
 * hosted server (a Node worker thread). It hands the worker a project, answers the worker's requests
 * for samples and audio clips with the loaders the caller gave, and resolves with the render.
 *
 * One worker serves every render, made on first use. A worker that fails, or a render that runs past
 * its time limit, takes the worker down with every render waiting on it; the next render makes a new one.
 */
import type { ProjectData } from "../../project/types";
import type { ProjectRender, ProjectRenderOptions } from "../renderProject";
import type { LoadAudio, LoadSample } from "../sampleAudio";
import type { FromWorker, ToWorker } from "./messages";

/** The asker's end of a worker: what a Web Worker and a worker thread both offer. */
export interface ClientPort {
  post(message: ToWorker, transfer?: ArrayBuffer[]): void;
  listen(handler: (message: FromWorker) => void): void;
  /** Called when the worker itself fails, rather than one render in it. */
  onFail(handler: (error: Error) => void): void;
  terminate(): void;
}

export interface RenderJob {
  project: ProjectData;
  engine: ArrayBuffer;
  sampleRate: number;
  options?: ProjectRenderOptions;
  load: { sample: LoadSample; audio: LoadAudio };
  /** How long it may take before it's given up on, worker and all. No limit unless given. */
  timeoutMs?: number;
}

export class RenderTimeoutError extends Error {}

interface Pending {
  load: RenderJob["load"];
  resolve: (render: ProjectRender) => void;
  reject: (error: Error) => void;
}

export function renderClient(spawn: () => ClientPort) {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let worker: ClientPort | null = null;

  /** Stop the worker and fail everything waiting on it. */
  const fail = (error: Error) => {
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  const handlers: { [Kind in FromWorker["kind"]]: (message: Extract<FromWorker, { kind: Kind }>) => void } = {
    load: ({ id, request, what, ref }) => {
      const render = pending.get(id);
      const loading = render ? render.load[what](ref) : Promise.resolve(null);
      // Copied across rather than transferred: a loader may keep what it decoded for the next render
      // (the server's do), and a transfer would empty it here.
      void loading.catch(() => null).then((audio) => worker?.post({ kind: "loaded", request, audio }));
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

  const ready = (): ClientPort => {
    if (worker) return worker;
    const started = spawn();
    started.listen((message) => (handlers[message.kind] as (message: FromWorker) => void)(message));
    started.onFail(fail);
    return (worker = started);
  };

  /** Render a project's arrangement on the engine render core, in the worker. */
  return ({ project, engine, sampleRate, options = {}, load, timeoutMs }: RenderJob): Promise<ProjectRender> => {
    const port = ready();
    const id = nextId++;
    return new Promise<ProjectRender>((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => fail(new RenderTimeoutError(`the render took over ${timeoutMs / 1000} s`)), timeoutMs);
      const settle =
        <Value>(then: (value: Value) => void) =>
        (value: Value) => {
          clearTimeout(timer);
          then(value);
        };
      pending.set(id, { load, resolve: settle(resolve), reject: settle(reject) });
      port.post({ kind: "render", id, project, engine, sampleRate, options }, [engine]);
    });
  };
}
