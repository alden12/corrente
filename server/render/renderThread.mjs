// The worker thread's entry (AGENT-4.9, HOST-22): register tsx in this thread, then load the
// TypeScript. Plain JavaScript so it runs before anything can compile TypeScript, whichever Node
// runs it: passing `--import tsx` in the worker's execArgv worked on Node 24 but not on Node 22,
// where Node's own type stripping loaded the .ts and failed on extensionless imports.
import { register } from "tsx/esm/api";

register();
await import("./renderThread.ts");
