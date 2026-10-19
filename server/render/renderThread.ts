/**
 * The engine render core on a Node worker thread (AGENT-4.9 part 3c, HOST-22): what serveRenders
 * does, at the thread's end of its port. Started by threadRender.ts.
 */
import { parentPort } from "node:worker_threads";
import { serveRenders } from "../../src/audio/render/worker/serveRenders";
import type { ToWorker } from "../../src/audio/render/worker/messages";

const port = parentPort!;
serveRenders({
  post: (message, transfer = []) => port.postMessage(message, transfer),
  listen: (handler) => port.on("message", (message: ToWorker) => handler(message)),
});
