/**
 * The engine render core in a browser Web Worker (AGENT-4.9 part 3b): a project rendered off the main
 * thread, so the page keeps playing and drawing while the agent listens or a song exports. What it
 * does is serveRenders'; this is only the worker's end of its port.
 */
import { serveRenders } from "./serveRenders";
import type { FromWorker, ToWorker } from "./messages";

/** The worker's global scope, typed here since the app's types are the page's (DOM), not a worker's. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: ArrayBuffer[]): void;
};

serveRenders({
  post: (message, transfer = []) => scope.postMessage(message, transfer),
  listen: (handler) => (scope.onmessage = ({ data }) => handler(data)),
});
