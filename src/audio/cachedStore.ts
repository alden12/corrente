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
 *
 * Boot doesn't wait for the server when it doesn't have to (HOST-25): a project this device holds opens
 * from its copy alone (`openLocally`), while the server, which can take seconds to wake, is asked for
 * the list in parallel. Each copy notes which account the server listed it for, since the cache is one
 * per device (HOST-29) and one account's projects must not open for another.
 */
import type { BundleStore, ProjectListing, ProjectStorage } from "./bundleStore";
import type { EditEntry } from "./commands/types";

/** One project's bundle with a remote primary and an OPFS mirror. */
export class CachedBundleStore implements BundleStore {
  private readonly remote: BundleStore;
  private readonly cache: BundleStore;
  /** Whether the last read fell back to the cache. */
  private offline = false;
  /** Whether reads are being served from the cache alone, without asking the remote. */
  private readonly local: () => boolean;

  constructor(remote: BundleStore, cache: BundleStore, local: () => boolean = () => false) {
    this.remote = remote;
    this.cache = cache;
    this.local = local;
  }

  unreachable(): boolean {
    return this.offline;
  }

  /** Read from the remote, noting whether it answered; the cache answers when it can't. */
  private async readThrough<T>(remote: () => Promise<T>, cached: () => Promise<T>): Promise<T> {
    if (this.local()) return cached();
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
  /** Whose projects these are: the account a listing is noted against. */
  private readonly account: () => string;
  /** The projects being opened from the cache alone, once per opening: boot can run twice at once. */
  private readonly localOpens: string[] = [];

  constructor(remote: ProjectStorage, cache: ProjectStorage, account: () => string = () => "") {
    this.remote = remote;
    this.cache = cache;
    this.account = account;
  }

  unreachable(): boolean {
    return this.offline;
  }

  bundle(projectId: string): BundleStore {
    return new CachedBundleStore(this.remote.bundle(projectId), this.cache.bundle(projectId), () =>
      this.localOpens.includes(projectId),
    );
  }

  /** This account's projects as the server last listed them, read from the cache alone. */
  async listLocal(): Promise<ProjectListing[]> {
    const listings = await this.cache.listProjects();
    const accounts = await Promise.all(
      listings.map((listing) => this.cache.bundle(listing.id).readText(LISTED_FOR_PATH).then(accountOf)),
    );
    return listings.filter((_, index) => accounts[index] === this.account());
  }

  /** Run `open` with `projectId` read from the cache alone, if the cache holds it. Resolves whether it did. */
  async openLocally(projectId: string, open: () => Promise<void>): Promise<boolean> {
    if (!(await this.cache.bundle(projectId).exists("manifest.json"))) return false;
    this.localOpens.push(projectId);
    try {
      await open();
    } finally {
      this.localOpens.splice(this.localOpens.indexOf(projectId), 1);
    }
    return true;
  }

  async listProjects(): Promise<ProjectListing[]> {
    try {
      const listings = await this.remote.listProjects();
      this.offline = false;
      // Mirror each title into the cache bundle's meta.json so an offline library still shows real
      // names (the remote backend does not itself write meta.json), and whose list it was, in a file of
      // the cache's own, since reading meta.json mirrors the server's copy over ours. Best-effort per project.
      const listedFor = JSON.stringify({ account: this.account() });
      await Promise.allSettled(
        listings.flatMap((listing) => {
          const bundle = this.cache.bundle(listing.id);
          const meta = { name: listing.name, modifiedAt: listing.modifiedAt, summary: listing.summary ?? null };
          return [bundle.writeText("meta.json", JSON.stringify(meta)), bundle.writeText(LISTED_FOR_PATH, listedFor)];
        }),
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

/** Which account the server listed a cached project for: written only here, never read through. */
const LISTED_FOR_PATH = "listed-for.json";

/** The account in a `listed-for.json`, or undefined if it doesn't say. */
function accountOf(raw: string | null): string | undefined {
  try {
    const account: unknown = (JSON.parse(raw ?? "") as { account?: unknown }).account;
    return typeof account === "string" ? account : undefined;
  } catch {
    return undefined;
  }
}
