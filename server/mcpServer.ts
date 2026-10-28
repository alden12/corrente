/**
 * The local MCP server: the tools over a WebSocket to the open DAW tab. A control-plane over the
 * project model, never an audio path: tools read a mirror of the tab's project, validate against each
 * instrument's schema, and forward edits to the tab, which applies them as the agent. Everything is
 * track-addressed; `track` defaults to the selected track when omitted.
 *
 * The tools themselves live in `mcp/tools/`, registered against a `DawTarget`; this file is the
 * target that is a browser tab. `createDawMcp` returns the McpServer plus a close fn so it can be
 * driven by a stdio transport in production and an in-memory transport in tests.
 */
import type { IncomingMessage } from "node:http";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { ProjectStore } from "../src/audio/project/projectStore";
import { DEFAULT_WS_PORT, LOCAL_HOSTNAMES } from "../src/audio/mcp/protocol";
import type {
  BrowserToServer,
  ClientKind,
  HistoryMethod,
  PatchMethod,
  ServerToBrowser,
} from "../src/audio/mcp/protocol";
import type { DawTarget, Reply } from "./mcp/target";
import { makeToolContext, type ToolHost } from "./mcp/context";
import { PLUGIN_TOOLS } from "./mcp/pluginTools";
import { registerDawTools } from "./mcp/tools";

/** How long a device edit may take to land in the tab, before the tool says it didn't answer. */
const DEVICE_TIMEOUT_MS = 20_000;
/** How long the tab gets to render and measure the song for analyze_mix. */
const ANALYSIS_TIMEOUT_MS = 120_000;
/** Whether a browser page's Origin is a page served from this machine. */
const fromThisMachine = (origin: string): boolean => {
  try {
    return LOCAL_HOSTNAMES.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/** How long a new server keeps asking another session's for the port, and how often it tries again. */
const TAKEOVER_WAIT_MS = 3000;
const TAKEOVER_RETRY_MS = 150;

export interface DawMcp {
  server: McpServer;
  close(): Promise<void>;
}

export function createDawMcp(options: { port?: number; onError?: (err: NodeJS.ErrnoException) => void } = {}): DawMcp {
  const port = options.port ?? DEFAULT_WS_PORT;

  // The server's mirror of the tab's project, kept current by the sync messages.
  const mirror = new ProjectStore(false);

  // Pending version-history RPCs, keyed by correlation id (see requestTab).
  const pending = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextReqId = 0;

  /**
   * The tab the agent drives. Every open tab connects, but only one is driven: the one most recently in
   * front of the user (AGENT-32), by the attention times the tabs report. The mirror is that tab's
   * project, so sync from any other tab is ignored.
   */
  let tab: WebSocket | null = null;
  const attention = new Map<WebSocket, number>();
  /** What each page said it is (`hello`): one that hasn't said is the app. */
  const kinds = new Map<WebSocket, ClientKind>();
  /** Every tool, by name, to hide those a plugin's window can't take while one is driven (PLUGIN-4). */
  const registered = new Map<string, RegisteredTool>();
  /** Show the tools the driven page takes, and hide the rest; MCP clients hear the list change. */
  const scopeTools = () => {
    const plugin = tab !== null && kinds.get(tab) === "plugin";
    registered.forEach((tool, name) => {
      const shown = !plugin || PLUGIN_TOOLS.has(name);
      if (tool.enabled !== shown) tool[shown ? "enable" : "disable"]();
    });
  };
  /** Sockets from something other than a browser (no Origin header): the only ones allowed a takeover. */
  const local = new WeakSet<WebSocket>();
  /** Set once another session's server took the port: this one stays up but drives nothing. */
  let handedOver = false;

  const sendTo = (socket: WebSocket, msg: ServerToBrowser) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  };
  const announce = () =>
    attention.forEach((_, socket) => sendTo(socket, { type: "agentTarget", active: socket === tab }));
  /** Drive `next` instead, asking it for its whole project, since the mirror holds the last tab's. */
  const retarget = (next: WebSocket | null) => {
    if (next === tab) return;
    tab = next;
    if (tab) sendTo(tab, { type: "resync" });
    announce();
    scopeTools();
  };
  const mostAttended = () =>
    [...attention].reduce<[WebSocket, number] | null>(
      (best, entry) => (best && best[1] >= entry[1] ? best : entry),
      null,
    )?.[0] ?? null;

  /** Sync from the driven tab only: it's that tab's project the tools read. */
  const fromTab =
    <Message>(load: (msg: Message) => void) =>
    (msg: Message, socket: WebSocket) => {
      if (socket === tab) load(msg);
    };

  // One handler per inbound message (map dispatch, not if/else). Mapped type
  // makes leaving a message type unhandled a compile error.
  type Inbound = {
    [K in BrowserToServer["type"]]: (msg: Extract<BrowserToServer, { type: K }>, socket: WebSocket) => void;
  };
  const inbound: Inbound = {
    projectSnapshot: fromTab((msg) => mirror.load(msg.project)),
    projectStructure: fromTab((msg) => mirror.load(msg.project)),
    paramChanged: fromTab((msg) => {
      const t = mirror.getTrack(msg.trackId);
      if (t?.kind === "instrument") t.params.set(msg.id, msg.value);
    }),
    clipSnapshot: fromTab((msg) => mirror.getClipStore(msg.trackId, msg.clipId)?.load(msg.clip)),
    effectParamChanged: fromTab((msg) => mirror.getEffect(msg.hostId, msg.effectId)?.params.set(msg.id, msg.value)),
    midiDeviceParamChanged: fromTab((msg) =>
      mirror.getMidiDevice(msg.trackId, msg.deviceId)?.params.set(msg.id, msg.value),
    ),
    // Replies are answered by id, so they count from whichever tab was asked.
    historyReply: (msg) => resolvePending(msg),
    patchReply: (msg) => resolvePending(msg),
    analysisReply: (msg) => resolvePending(msg),
    deviceReply: (msg) => resolvePending(msg),
    attention: (msg, socket) => {
      attention.set(socket, msg.at);
      if (!tab || msg.at > (attention.get(tab) ?? 0)) retarget(socket);
    },
    takeover: (_msg, socket) => {
      if (local.has(socket)) handOver();
    },
    hello: (msg, socket) => {
      kinds.set(socket, msg.kind);
      if (socket === tab) scopeTools();
    },
  };

  // Both RPC paths (history, patches) correlate by a shared id and resolve here.
  const resolvePending = (msg: { id: string; ok: boolean; result?: unknown; error?: string }) => {
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.delete(msg.id);
    waiting.resolve({ ok: msg.ok, result: msg.result, error: msg.error });
  };

  const onConnection = (socket: WebSocket, request: IncomingMessage) => {
    const { origin } = request.headers;
    if (origin === undefined) local.add(socket);
    // A page from anywhere else could otherwise feed the agent a project and read its edits.
    else if (!fromThisMachine(origin))
      return socket.close(1008, "Only a page served from this machine can drive the DAW.");
    // A tab that hasn't said when it was last in front counts as never; the first one is driven anyway.
    attention.set(socket, 0);
    if (!tab) tab = socket;
    announce();
    socket.on("message", (raw: RawData) => {
      let msg: BrowserToServer;
      try {
        msg = JSON.parse(raw.toString()) as BrowserToServer;
      } catch {
        return;
      }
      (inbound[msg.type] as ((m: BrowserToServer, from: WebSocket) => void) | undefined)?.(msg, socket);
    });
    socket.on("close", () => {
      attention.delete(socket);
      kinds.delete(socket);
      if (tab === socket) retarget(mostAttended());
    });
  };

  /**
   * Listen for tabs. If another Claude Code session's server has the port, ask it to hand over and
   * try again for a few seconds: the session started last gets the app, and the other one says so
   * when its tools are called. One that predates the handover never answers, and this one gives up.
   */
  let wss: WebSocketServer;
  const listen = (deadline: number) => {
    wss = new WebSocketServer({ port, host: "127.0.0.1" });
    wss.on("connection", onConnection);
    wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && Date.now() < deadline) {
        askToHandOver();
        setTimeout(() => listen(deadline), TAKEOVER_RETRY_MS);
        return;
      }
      console.error(`[corrente] WebSocket server error: ${err.message}`);
      options.onError?.(err);
    });
  };
  const askToHandOver = () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "takeover" } satisfies BrowserToServer));
      socket.close();
    });
    socket.on("error", () => undefined);
  };
  /** Give the port up to a newer session's server: the tabs reconnect to it, and this one drives nothing. */
  const handOver = () => {
    console.error("[corrente] Another Claude Code session took the app; this one now stands by.");
    handedOver = true;
    tab = null;
    attention.clear();
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
  listen(Date.now() + TAKEOVER_WAIT_MS);

  const connected = () => tab !== null && tab.readyState === WebSocket.OPEN;
  const whyNotConnected = () =>
    handedOver
      ? "Another Claude Code session has the app now. Reconnect corrente from /mcp to take it back."
      : "No DAW tab connected.";
  const sendToTab = (msg: ServerToBrowser): boolean => {
    if (!connected()) return false;
    tab!.send(JSON.stringify(msg));
    return true;
  };

  /**
   * Round-trip a version-history RPC to the tab and await its reply. The DAG lives
   * in the tab (OPFS), so these tools can't read the mirror - they ask the tab.
   * Rejects if no tab is connected or the reply doesn't arrive in time.
   */
  const awaitReply = (sendRequest: (id: string) => boolean, timeoutMs = 5000): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const id = `rq-${nextReqId++}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The DAW tab did not respond in time."));
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      if (!sendRequest(id)) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(whyNotConnected()));
      }
    });

  const requestTab = (method: HistoryMethod, params?: Record<string, unknown>): Promise<Reply> =>
    awaitReply((id) => sendToTab({ type: "historyRequest", id, method, params }));

  /** Round-trip a patch-library RPC to the tab (patches live in its library, on the device). */
  const requestPatch = (method: PatchMethod, params?: Record<string, unknown>): Promise<Reply> =>
    awaitReply((id) => sendToTab({ type: "patchRequest", id, method, params }));

  const target: DawTarget = {
    project: mirror,
    send: sendToTab,
    // Behind any edits still landing and the library's own writes: give it longer than a lookup.
    landDevice: (edit) => awaitReply((id) => sendToTab({ type: "deviceRequest", id, edit }), DEVICE_TIMEOUT_MS),
    connected,
    whyNotConnected,
    requestHistory: requestTab,
    requestPatch,
    // A song takes a moment to render, a long one longer, so this waits well past the other requests.
    analyzeMix: (mix) => awaitReply((id) => sendToTab({ type: "analysisRequest", id, mix }), ANALYSIS_TIMEOUT_MS),
    analyzeDevice: (device) =>
      awaitReply((id) => sendToTab({ type: "analysisRequest", id, device }), ANALYSIS_TIMEOUT_MS),
  };
  const server = new McpServer({ name: "corrente", version: "0.1.0" });
  // Each tool kept by name as it's registered, for `scopeTools`.
  const host: ToolHost = {
    registerTool: ((name: string, ...rest: unknown[]) => {
      const tool = (server.registerTool as (name: string, ...rest: unknown[]) => RegisteredTool)(name, ...rest);
      registered.set(name, tool);
      return tool;
    }) as ToolHost["registerTool"],
  };
  const context = makeToolContext(host, target);
  registerDawTools(context);
  scopeTools();

  const close = async () => {
    context.clearSequence();
    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const client of wss.clients) client.terminate();
    tab = null;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await server.close().catch(() => undefined);
  };

  return { server, close };
}
