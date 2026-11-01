/**
 * A read-through cache over the remote sync backend, so remote mode keeps a local working copy of the
 * projects it has seen and can load / render them with no network. It wraps a `remote` ProjectStorage
 * (the sync server) and a `cache` ProjectStorage (OPFS, under its own dir) behind the same seam, so
 * nothing above it (repository, library, autosave) changes.
 *
 * Reads: try the remote; on success mirror the value into the cache and return it; if the remote is
 * unreachable, serve the last-synced value from the cache. A remote read that authoritatively returns
 * `null` (the file genuinely does not exist) is passed through as-is - only a *thrown* read (offline /
 * server unreachable) falls back to the cache.
 *
 * Writes: mirror into the cache, then write to the remote with its errors propagating exactly as before.
 * This is the deliberate boundary of this increment: it makes offline *reads* work (load the current
 * project, its edit tail, and its samples) without yet changing write semantics. Making offline *writes*
 * durable - queue them locally and flush on reconnect - is the next increment (the durable write-queue);
 * this cache is the local store that queue will build on.
 *
 * A read the cache answered is noted (`unreachable`): the local copy holds only what was read before,
 * so a project that won't open from it is out of reach, not damaged (HOST-36).
 */
import type { BundleStore, ProjectListing, ProjectStorage } from "./bundleStore";
import type { EditEntry } from "./commands/types";

/** One project's bundle with a remote primary and an OPFS mirror. */
export class CachedBundleStore implements BundleStore {
  private readonly remote: BundleStore;
  private readonly cache: BundleStore;
  /** Whether the last read fell back to the cache. */
  private offline = false;

  constructor(remote: BundleStore, cache: BundleStore) {
    this.remote = remote;
    this.cache = cache;
  }

  unreachable(): boolean {
    return this.offline;
  }

  /** Read from the remote, noting whether it answered; the cache answers when it can't. */
  private async readThrough<T>(remote: () => Promise<T>, cached: () => Promise<T>): Promise<T> {
    try {
      const value = await remote();
      this.offline = false;
      return value;
    } catch {
      this.offline = true;
      return cached();
    }
  }

  readText(path: string): Promise<string | null> {
    return this.readThrough(
      async () => {
        const value = await this.remote.readText(path);
        if (value !== null) await this.cache.writeText(path, value);
        return value;
      },
      () => this.cache.readText(path),
    );
  }

  readBlob(path: string): Promise<ArrayBuffer | null> {
    return this.readThrough(
      async () => {
        const value = await this.remote.readBlob(path);
        if (value !== null) await this.cache.writeBlob(path, new Blob([value]));
        return value;
      },
      () => this.cache.readBlob(path),
    );
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.cache.writeText(path, text);
    await this.remote.writeText(path, text);
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    await this.cache.writeBlob(path, blob);
    await this.remote.writeBlob(path, blob);
  }

  exists(path: string): Promise<boolean> {
    return this.readThrough(
      () => this.remote.exists(path),
      () => this.cache.exists(path),
    );
  }

  async appendEdits(entries: EditEntry[]): Promise<void> {
    await this.cache.appendEdits(entries);
    await this.remote.appendEdits(entries);
  }

  readEdits(sinceSeq: number, limit?: number): Promise<EditEntry[]> {
    return this.readThrough(
      async () => {
        const entries = await this.remote.readEdits(sinceSeq, limit);
        // Mirror the fetched window into the local log (idempotent by seq), so an offline reload can
        // reconstruct HEAD from the cached keyframe + this tail.
        if (entries.length > 0) await this.cache.appendEdits(entries);
        return entries;
      },
      () => this.cache.readEdits(sinceSeq, limit),
    );
  }
}

/** The multi-project root with a remote primary and an OPFS mirror. */
export class CachedProjectStorage implements ProjectStorage {
  private readonly remote: ProjectStorage;
  private readonly cache: ProjectStorage;
  /** Whether the last listing fell back to the cache. */
  private offline = false;

  constructor(remote: ProjectStorage, cache: ProjectStorage) {
    this.remote = remote;
    this.cache = cache;
  }

  unreachable(): boolean {
    return this.offline;
  }

  bundle(projectId: string): BundleStore {
    return new CachedBundleStore(this.remote.bundle(projectId), this.cache.bundle(projectId));
  }

  async listProjects(): Promise<ProjectListing[]> {
    try {
      const listings = await this.remote.listProjects();
      this.offline = false;
      // Mirror each title into the cache bundle's meta.json so an offline library still shows real
      // names (the remote backend does not itself write meta.json). Best-effort per project.
      await Promise.allSettled(
        listings.map((listing) =>
          this.cache
            .bundle(listing.id)
            .writeText(
              "meta.json",
              JSON.stringify({ name: listing.name, modifiedAt: listing.modifiedAt, summary: listing.summary ?? null }),
            ),
        ),
      );
      return listings;
    } catch {
      // Offline: list whatever the mirror holds. Role reads back as "owner" (sharing is server-enforced;
      // offline you only have your cached copy) - an accepted offline-listing limitation.
      this.offline = true;
      return this.cache.listProjects();
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.remote.deleteProject(projectId);
    await this.cache.deleteProject(projectId).catch(() => {});
  }
}
