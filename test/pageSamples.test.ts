import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/audio/bank/devicePackage";
import { ProjectStore } from "../src/audio/project/projectStore";
import { NO_SAMPLES, pageSamples } from "../src/plugin/pageSamples";

/**
 * A sample of your own in the plugin's window (PLUGIN-3.6): read from the window's storage where it
 * was imported, else from what the plugin saved with the host's project. Here there is no storage
 * (Node has no OPFS), so it's always the second.
 */

const project = () => {
  const store = new ProjectStore(false);
  store.addSample({ id: "mine", name: "Mine", contentHash: "abc", source: "import" });
  return store;
};

describe("pageSamples", () => {
  it("reads a sample of your own as the plugin saved it, when the window's storage hasn't it", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const samples = pageSamples(project(), { files: { "asset:mine": toBase64(bytes) }, tables: {} });
    expect(await samples.file("asset:mine")).toEqual(bytes);
    expect(await samples.file("asset:other")).toBeNull();
  });

  it("plays a wavetable's saved table when its sample can't be read", async () => {
    const table = Float32Array.from([0, 0.5, -0.5, 0]);
    const saved = { files: {}, tables: { "asset:mine": toBase64(new Uint8Array(table.buffer)) } };
    expect(await pageSamples(project(), saved).table("asset:mine")).toEqual(table);
    expect(await pageSamples(project(), NO_SAMPLES).table("asset:mine")).toBeNull();
  });
});
