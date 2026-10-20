/**
 * The asking side of the render worker (AGENT-4.9 part 3), shared by the page (a Web Worker) and the
 * hosted server (a Node worker thread). It hands the worker a project (or a device to draw, COMM-1.9.6), answers the worker's requests
 * for samples and audio clips with the loaders the caller gave, and resolves with the render.
 *
 * One worker serves every render, made on first use. A worker that fails, or a render that runs past
 * its time limit, takes the worker down with every render waiting on it; the next render makes a new one.
 */
import type { ProjectData } from "../../project/types";
import type { ProjectRender, ProjectRenderOptions } from "../renderProject";
import type { LoadAudio, LoadSample } from "../sampleAudio";
import type { Portrait } from "../../portraits/draw";
import type { PortraitJob } from "../../portraits/devicePortrait";
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

/** A device's portrait to draw (COMM-1.9.6): what, the engine to play it on, and where its samples come from. */
export interface PortraitDraw {
  job: PortraitJob;
  engine: ArrayBuffer;
  load: { sample: LoadSample };
  timeoutMs?: number;
}

export class RenderTimeoutError extends Error {}

interface Pending {
  load: Partial<RenderJob["load"]>;
  resolve: (result: never) => void;
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

  /** A job that just finished, no longer waited on. */
  const settled = (id: number) => {
    const job = pending.get(id);
    pending.delete(id);
    return job;
  };

  const handlers: { [Kind in FromWorker["kind"]]: (message: Extract<FromWorker, { kind: Kind }>) => void } = {
    load: ({ id, request, what, ref }) => {
      const render = pending.get(id);
      const loading = render?.load[what]?.(ref) ?? Promise.resolve(null);
      // Copied across rather than transferred: a loader may keep what it decoded for the next render
      // (the server's do), and a transfer would empty it here.
      void loading.catch(() => null).then((audio) => worker?.post({ kind: "loaded", request, audio }));
    },
    done: ({ id, render }) => settled(id)?.resolve(render as never),
    drawn: ({ id, portrait }) => settled(id)?.resolve(portrait as never),
    failed: ({ id, message }) => settled(id)?.reject(new Error(message)),
  };

  const ready = (): ClientPort => {
    if (worker) return worker;
    const started = spawn();
    started.listen((message) => (handlers[message.kind] as (message: FromWorker) => void)(message));
    started.onFail(fail);
    return (worker = started);
  };

  /** Post a job, and wait for its answer: given up on, worker and all, after `timeoutMs` if given. */
  const ask = <Result>(
    message: (id: number) => ToWorker,
    engine: ArrayBuffer,
    load: Pending["load"],
    timeoutMs?: number,
  ): Promise<Result> => {
    const port = ready();
    const id = nextId++;
    return new Promise<Result>((resolve, reject) => {
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
      pending.set(id, { load, resolve: settle(resolve) as (result: never) => void, reject: settle(reject) });
      port.post(message(id), [engine]);
    });
  };

  return {
    /** Render a project's arrangement on the engine render core, in the worker. */
    render: ({ project, engine, sampleRate, options = {}, load, timeoutMs }: RenderJob): Promise<ProjectRender> =>
      ask((id) => ({ kind: "render", id, project, engine, sampleRate, options }), engine, load, timeoutMs),
    /** Draw one device's portrait, in the worker (COMM-1.9.6). */
    portrait: ({ job, engine, load, timeoutMs }: PortraitDraw): Promise<Portrait> =>
      ask((id) => ({ kind: "portrait", id, job, engine }), engine, load, timeoutMs),
  };
}
