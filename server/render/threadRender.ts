/**
 * Render a project on a Node worker thread (AGENT-4.9 part 3c, HOST-22), so a render never holds up
 * the server's other requests. One thread serves every render, made on first use (renderClient.ts).
 *
 * From source, the thread runs TypeScript as the server does, through tsx, which its plain-JavaScript
 * entry (renderThread.mjs) registers before loading anything. A precompiled server (HOST-32) starts
 * its bundled worker instead, whose URL the bundle's banner leaves on `globalThis`. It's unref'd, so
 * an idle one never keeps the process alive.
 */
import { Worker } from "node:worker_threads";
import { renderClient } from "../../src/audio/render/worker/renderClient";
import type { FromWorker } from "../../src/audio/render/worker/messages";

declare global {
  /** The bundled render worker's URL, set by a precompiled server's banner (server/scripts/bundle.ts). */
  var CORRENTE_RENDER_WORKER: string | undefined;
}

const thread = renderClient(() => {
  const worker = new Worker(
    new URL(globalThis.CORRENTE_RENDER_WORKER ?? new URL("./renderThread.mjs", import.meta.url)),
  );
  worker.unref();
  return {
    post: (message, transfer = []) => worker.postMessage(message, transfer),
    listen: (handler) => worker.on("message", (message: FromWorker) => handler(message)),
    onFail: (handler) => worker.on("error", handler),
    terminate: () => void worker.terminate(),
  };
});

export const renderInThread = thread.render;
