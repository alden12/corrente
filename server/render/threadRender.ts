/**
 * Render a project on a Node worker thread (AGENT-4.9 part 3c, HOST-22), so a render never holds up
 * the server's other requests. One thread serves every render, made on first use (renderClient.ts).
 *
 * The thread runs TypeScript as the server does, through tsx. It's unref'd, so an idle one never
 * keeps the process alive.
 */
import { Worker } from "node:worker_threads";
import { renderClient } from "../../src/audio/render/worker/renderClient";
import type { FromWorker } from "../../src/audio/render/worker/messages";

export const renderInThread = renderClient(() => {
  const worker = new Worker(new URL("./renderThread.ts", import.meta.url), { execArgv: ["--import", "tsx"] });
  worker.unref();
  return {
    post: (message, transfer = []) => worker.postMessage(message, transfer),
    listen: (handler) => worker.on("message", (message: FromWorker) => handler(message)),
    onFail: (handler) => worker.on("error", handler),
    terminate: () => void worker.terminate(),
  };
});
