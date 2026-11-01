/**
 * The remote-mode read-through cache (src/audio/cachedStore.ts). Verifies it mirrors remote reads into a
 * local store, serves them when the remote is unreachable (offline load / render), and preserves remote
 * write-error semantics (offline writes still throw here - durability is the next increment). The
 * "remote" is a MemoryProjectStorage behind a gate that throws on every op when flipped offline.
 */
import { describe, expect, it } from "vitest";
import { MemoryProjectStorage, type BundleStore, type ProjectStorage } from "../src/audio/bundleStore";
import { CachedProjectStorage } from "../src/audio/cachedStore";
import type { EditEntry } from "../src/audio/commands/types";
import { ProjectStore } from "../src/audio/project/projectStore";
import { ProjectRepository, UnreachableProjectError, UnreadableProjectError } from "../src/audio/projectRepository";

/** Flips the fake remote between reachable and offline (every op rejects). */
class Gate {
  offline = false;
  run<T>(op: () => Promise<T>): Promise<T> {
    return this.offline ? Promise.reject(new Error("offline")) : op();
  }
}

class GatedBundle implements BundleStore {
  constructor(
    private readonly inner: BundleStore,
    private readonly gate: Gate,
  ) {}
  readText(path: string) {
    return this.gate.run(() => this.inner.readText(path));
  }
  writeText(path: string, text: string) {
    return this.gate.run(() => this.inner.writeText(path, text));
  }
  readBlob(path: string) {
    return this.gate.run(() => this.inner.readBlob(path));
  }
  writeBlob(path: string, blob: Blob) {
    return this.gate.run(() => this.inner.writeBlob(path, blob));
  }
  exists(path: string) {
    return this.gate.run(() => this.inner.exists(path));
  }
  appendEdits(entries: EditEntry[]) {
    return this.gate.run(() => this.inner.appendEdits(entries));
  }
  readEdits(sinceSeq: number, limit?: number) {
    return this.gate.run(() => this.inner.readEdits(sinceSeq, limit));
  }
}

class GatedStorage implements ProjectStorage {
  constructor(
    private readonly inner: ProjectStorage,
    private readonly gate: Gate,
  ) {}
  bundle(projectId: string) {
    return new GatedBundle(this.inner.bundle(projectId), this.gate);
  }
  listProjects() {
    return this.gate.run(() => this.inner.listProjects());
  }
  deleteProject(projectId: string) {
    return this.gate.run(() => this.inner.deleteProject(projectId));
  }
}

/** A remote server (memory) behind a gate, plus a memory cache, fronted by the cache under test. */
function makeCached() {
  const gate = new Gate();
  const server = new MemoryProjectStorage();
  const cache = new MemoryProjectStorage();
  const cached = new CachedProjectStorage(new GatedStorage(server, gate), cache);
  return { gate, server, cache, cached };
}

const edit = (seq: number): EditEntry => ({
  seq,
  command: { type: "createTrack", id: `t-${seq}`, instrumentType: "subtractive" },
  author: "you",
  time: 0,
  kind: "edit",
});

describe("CachedProjectStorage read-through cache", () => {
  it("mirrors a remote read into the cache and returns it", async () => {
    const { server, cache, cached } = makeCached();
    await server.bundle("p1").writeText("project.json", '{"name":"Song"}');

    const value = await cached.bundle("p1").readText("project.json");
    expect(value).toBe('{"name":"Song"}');
    // The read populated the cache, so a later offline read has something to serve.
    expect(await cache.bundle("p1").readText("project.json")).toBe('{"name":"Song"}');
  });

  it("serves the last-synced value from the cache when the remote is unreachable", async () => {
    const { gate, server, cached } = makeCached();
    await server.bundle("p1").writeText("project.json", '{"name":"Song"}');
    await cached.bundle("p1").readText("project.json"); // warm the cache while online

    gate.offline = true;
    expect(await cached.bundle("p1").readText("project.json")).toBe('{"name":"Song"}');
  });

  it("returns null for an uncached path while offline (a genuine miss, not a throw)", async () => {
    const { gate, cached } = makeCached();
    gate.offline = true;
    expect(await cached.bundle("p1").readText("never-seen.json")).toBeNull();
  });

  it("caches blobs (samples) and serves them offline", async () => {
    const { gate, server, cached } = makeCached();
    await server.bundle("p1").writeBlob("samples/abc", new Blob([new Uint8Array([1, 2, 3])]));
    await cached.bundle("p1").readBlob("samples/abc"); // warm

    gate.offline = true;
    const bytes = await cached.bundle("p1").readBlob("samples/abc");
    expect(bytes && new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("mirrors a fetched edit window so an offline reload can read the tail", async () => {
    const { gate, server, cached } = makeCached();
    await server.bundle("p1").appendEdits([edit(0), edit(1), edit(2)]);
    const online = await cached.bundle("p1").readEdits(-1);
    expect(online.map((entry) => entry.seq)).toEqual([0, 1, 2]);

    gate.offline = true;
    const offline = await cached.bundle("p1").readEdits(-1);
    expect(offline.map((entry) => entry.seq)).toEqual([0, 1, 2]);
  });
});

describe("CachedProjectStorage writes (increment-2 boundary: errors still propagate)", () => {
  it("writes through to both the cache and the remote when online", async () => {
    const { server, cache, cached } = makeCached();
    await cached.bundle("p1").writeText("project.json", '{"name":"New"}');
    expect(await server.bundle("p1").readText("project.json")).toBe('{"name":"New"}');
    expect(await cache.bundle("p1").readText("project.json")).toBe('{"name":"New"}');
  });

  it("still persists to the cache but propagates the error when a remote write fails offline", async () => {
    const { gate, cache, cached } = makeCached();
    gate.offline = true;
    await expect(cached.bundle("p1").writeText("project.json", '{"name":"Offline"}')).rejects.toThrow();
    // The local copy survives (the durable write-queue that flushes it on reconnect is the next increment).
    expect(await cache.bundle("p1").readText("project.json")).toBe('{"name":"Offline"}');
  });
});

describe("CachedProjectStorage listing", () => {
  it("mirrors project titles so an offline library still shows real names", async () => {
    const { gate, server, cached } = makeCached();
    await server.bundle("p1").writeText("meta.json", JSON.stringify({ name: "My Beat", modifiedAt: "2026-01-01" }));

    const online = await cached.listProjects();
    expect(online.find((entry) => entry.id === "p1")?.name).toBe("My Beat");

    gate.offline = true;
    const offline = await cached.listProjects();
    expect(offline.find((entry) => entry.id === "p1")?.name).toBe("My Beat");
  });
});

describe("a project out of reach is not a damaged one (HOST-36)", () => {
  /** A project with a track saved on the server, as another device left it. */
  const saved = async (server: MemoryProjectStorage) => {
    const project = new ProjectStore(false);
    project.addTrack("subtractive");
    await new ProjectRepository(server.bundle("p1"), "p1").save(project.snapshot(), [], []);
  };

  it("notes whether the last read had to come from the cache", async () => {
    const { gate, cached } = makeCached();
    const bundle = cached.bundle("p1");
    await bundle.readText("project.json");
    expect(bundle.unreachable?.()).toBe(false);
    gate.offline = true;
    await bundle.readText("project.json");
    expect(bundle.unreachable?.()).toBe(true);
    gate.offline = false;
    await bundle.readEdits(-1);
    expect(bundle.unreachable?.()).toBe(false);
  });

  it("opens a project this device read before, offline, from its copy", async () => {
    const { gate, server, cached } = makeCached();
    await saved(server);
    await new ProjectRepository(cached.bundle("p1"), "p1").load();
    gate.offline = true;
    const loaded = await new ProjectRepository(cached.bundle("p1"), "p1").load();
    expect(loaded?.project.tracks).toHaveLength(1);
  });

  it("calls a project this device never read out of reach offline, not empty", async () => {
    const { gate, server, cached } = makeCached();
    await saved(server);
    gate.offline = true;
    await expect(new ProjectRepository(cached.bundle("p1"), "p1").load()).rejects.toBeInstanceOf(
      UnreachableProjectError,
    );
  });

  it("calls a copy that won't open out of reach offline, and damage only when the server says so", async () => {
    const { gate, server, cache, cached } = makeCached();
    await saved(server);
    await new ProjectRepository(cached.bundle("p1"), "p1").load();
    await cache.bundle("p1").writeText("project.json", "{ half a file");
    gate.offline = true;
    await expect(new ProjectRepository(cached.bundle("p1"), "p1").load()).rejects.toBeInstanceOf(
      UnreachableProjectError,
    );
    // Back online, the server's copy is read, and a damaged one there is damage.
    gate.offline = false;
    await server.bundle("p1").writeText("project.json", "{ half a file");
    await expect(new ProjectRepository(cached.bundle("p1"), "p1").load()).rejects.toBeInstanceOf(
      UnreadableProjectError,
    );
  });
});
