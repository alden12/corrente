/**
 * MCP server entry point. Claude Code spawns this over stdio (see .mcp.json);
 * it also opens a WebSocket the DAW tab connects to. Anything written to stdout
 * would corrupt the stdio MCP channel, so logs go to stderr.
 *
 * Lifecycle matters here: the WebSocket server keeps Node's event loop alive, so
 * we must exit when the stdio connection closes (or on a signal). Otherwise the
 * process lingers holding the WS port and the next spawn fails with EADDRINUSE.
 *
 * `CORRENTE_MCP_CRASH_LOG=<path>` appends each way the process can end to that file, with the time:
 * the server sometimes drops mid-call with nothing on stderr, and this is to catch it (AGENT-32).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDawMcp } from "./mcpServer";
import { DEFAULT_WS_PORT } from "../src/audio/mcp/protocol";

const port = process.env.WEBDAW_WS_PORT ? Number(process.env.WEBDAW_WS_PORT) : DEFAULT_WS_PORT;

const crashLog = process.env.CORRENTE_MCP_CRASH_LOG;
const log = (event: string) => {
  if (!crashLog) return;
  try {
    mkdirSync(dirname(crashLog), { recursive: true });
    appendFileSync(crashLog, `${new Date().toISOString()} [${process.pid}] ${event}\n`);
  } catch {
    // A log that can't be written mustn't take the server down with it.
  }
};
if (crashLog) {
  log(`start (parent ${process.ppid})`);
  process.on("exit", (code) => log(`exit ${code}`));
  // Handling these replaces Node's own report and exit, so this does both.
  process.on("uncaughtException", (error) => {
    log(`uncaught exception: ${error.stack ?? error.message}`);
    console.error(error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log(`unhandled rejection: ${String(reason)}`);
    throw reason;
  });
}

const { server, close } = createDawMcp({
  port,
  onError: (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[corrente] Port ${port} is in use, and whatever has it didn't hand it over. Exiting.`);
      log("port in use, not handed over");
      process.exit(1);
    }
  },
});

let shuttingDown = false;
const shutdown = (why: string) => () => {
  log(`shutdown: ${why}`);
  if (shuttingDown) return;
  shuttingDown = true;
  // Hard backstop: never let a wedged close() keep the process (and the WS port)
  // alive after the client has gone.
  const hard = setTimeout(() => process.exit(0), 1500);
  hard.unref();
  void close().finally(() => process.exit(0));
};

// Exit when Claude Code closes the stdio connection or signals us, so we release
// the WebSocket port instead of becoming an orphan. StdioServerTransport only
// watches stdin 'data'/'error', not EOF, so we watch stdin end/close ourselves
// (the WebSocket server would otherwise keep the event loop alive forever).
server.server.onclose = shutdown("MCP connection closed");
process.stdin.on("end", shutdown("stdin ended"));
process.stdin.on("close", shutdown("stdin closed"));
process.on("SIGINT", shutdown("SIGINT"));
process.on("SIGTERM", shutdown("SIGTERM"));
process.on("SIGHUP", shutdown("SIGHUP"));

await server.connect(new StdioServerTransport());
console.error(`[corrente] MCP server ready; DAW WebSocket on ws://localhost:${port}`);
