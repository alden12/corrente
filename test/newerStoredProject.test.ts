/**
 * HOST-23.1, layer 3 for stored projects: one saved by a newer app (a tab left open across an update)
 * is refused rather than opened, since this app would save it back down stamped with its own older
 * version. The app is marked out of date, which asks for a reload.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { MemoryBundleStore } from "../src/audio/bundleStore";
import { NewerFileError, ProjectRepository } from "../src/audio/projectRepository";
import { PROJECT_SCHEMA } from "../src/audio/project/documentMigration";
import { isOutdated } from "../src/contract/outdated";

describe("a stored project from a newer app", () => {
  it("is refused, leaves the bundle as it was, and marks this app out of date", async () => {
    const store = new MemoryBundleStore();
    await new ProjectRepository(store, "p-newer").save(new ProjectStore().snapshot(), [], []);
    const manifest = JSON.parse((await store.readText("manifest.json"))!);
    await store.writeText("manifest.json", JSON.stringify({ ...manifest, projectSchema: PROJECT_SCHEMA + 1 }));

    await expect(new ProjectRepository(store, "p-newer").load()).rejects.toBeInstanceOf(NewerFileError);
    expect(JSON.parse((await store.readText("manifest.json"))!).projectSchema).toBe(PROJECT_SCHEMA + 1);
    expect(isOutdated()).toBe(true);
  });
});
