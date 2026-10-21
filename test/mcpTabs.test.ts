import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebSocket } from "ws";
import { createDawMcp, type DawMcp } from "../server/mcpServer";
import { ProjectStore } from "../src/audio/project/projectStore";

// Which tab the local MCP drives, and which session has it (AGENT-32).

const PORT = 8798;
const URL = `ws://localhost:${PORT}`;

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };
type Message = { type: string; active?: boolean };

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Until an async check passes. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("eventually timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A running server with an MCP client on it, as one Claude Code session has. */
async function startSession(): Promise<{ daw: DawMcp; client: Client }> {
  const daw = createDawMcp({ port: PORT });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([daw.server.connect(serverTransport), client.connect(clientTransport)]);
  return { daw, client };
}

describe("MCP server with several tabs", () => {
  let session: { daw: DawMcp; client: Client };
  const sockets: WebSocket[] = [];

  const call = async (name: string, args: Record<string, unknown> = {}, client = session.client) =>
    (await client.callTool({ name, arguments: args })) as TextResult;
  const projectName = async () => JSON.parse((await call("list_tracks")).content[0].text).project as string;

  /** A fake tab with a project of its own, answering a resync as the bridge does, and what it's sent. */
  async function openTab(name: string, options: { origin?: string } = {}) {
    const messages: Message[] = [];
    const socket = new WebSocket(URL, { origin: options.origin });
    sockets.push(socket);
    const snapshot = () =>
      JSON.stringify({ type: "projectSnapshot", project: { ...new ProjectStore(false).snapshot(), name } });
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Message;
      messages.push(msg);
      if (msg.type === "resync") socket.send(snapshot());
    });
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", reject);
    });
    socket.send(snapshot());
    const sendAttention = (at: number) => socket.send(JSON.stringify({ type: "attention", at }));
    const driven = () => messages.filter((msg) => msg.type === "agentTarget").at(-1)?.active;
    return { socket, messages, sendAttention, driven };
  }

  /** Open a tab once the port is listening again, retrying as the bridge does. */
  async function reopen(name: string): ReturnType<typeof openTab> {
    const start = Date.now();
    for (;;) {
      try {
        return await openTab(name);
      } catch (error) {
        if (Date.now() - start > 2000) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  beforeEach(async () => {
    session = await startSession();
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.close());
    await session.client.close();
    await session.daw.close();
  });

  it("drives the first tab, not one that connects after it", async () => {
    const first = await openTab("First");
    await waitFor(() => first.driven() === true);
    const second = await openTab("Second");
    await waitFor(() => second.driven() === false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await projectName()).toBe("First");
  });

  it("moves to the tab most recently in front, and reads that tab's project", async () => {
    const first = await openTab("First");
    first.sendAttention(1000);
    const second = await openTab("Second");
    second.sendAttention(2000);
    await waitFor(() => second.driven() === true && first.driven() === false);
    expect(second.messages.some((msg) => msg.type === "resync")).toBe(true);
    await eventually(async () => (await projectName()) === "Second");

    // A tab that was in front longer ago doesn't take it back.
    first.sendAttention(1500);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(second.driven()).toBe(true);
  });

  it("falls back to the tab in front most recently when the driven one closes", async () => {
    const first = await openTab("First");
    const second = await openTab("Second");
    const third = await openTab("Third");
    second.sendAttention(3000);
    third.sendAttention(2000);
    await waitFor(() => second.driven() === true);
    second.socket.close();
    await waitFor(() => third.driven() === true);
    expect(first.driven()).toBe(false);
  });

  it("hands the port to a newer session, and the older one says so", async () => {
    const tab = await openTab("Tab");
    await waitFor(() => tab.driven() === true);
    const newer = await startSession();
    try {
      await waitFor(() => tab.socket.readyState === WebSocket.CLOSED);
      const answer = await call("create_track", { instrument: "subtractive" });
      expect(answer.isError).toBe(true);
      expect(answer.content[0].text).toMatch(/Another Claude Code session has the app/);

      // The tab reconnects, as the bridge does, and the newer session drives it.
      const again = await reopen("Tab again");
      await waitFor(() => again.driven() === true);
      await eventually(
        async () => JSON.parse((await call("list_tracks", {}, newer.client)).content[0].text).connected === true,
      );
    } finally {
      sockets.splice(0).forEach((socket) => socket.close());
      await newer.client.close();
      await newer.daw.close();
    }
  });

  it("takes no tab from a website, only from pages served on this machine", async () => {
    const website = new WebSocket(URL, { origin: "https://example.com" });
    const code = await new Promise<number>((resolve) => website.on("close", resolve));
    expect(code).toBe(1008);
    const tab = await openTab("Local page", { origin: "http://localhost:5155" });
    await waitFor(() => tab.driven() === true);
  });

  it("doesn't hand over to a page asking for it", async () => {
    const tab = await openTab("Tab");
    await waitFor(() => tab.driven() === true);
    const page = await openTab("Page", { origin: "http://localhost:5155" });
    page.socket.send(JSON.stringify({ type: "takeover" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tab.socket.readyState).toBe(WebSocket.OPEN);
    expect(tab.driven()).toBe(true);
  });
});
