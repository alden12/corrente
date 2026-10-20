import { describe, expect, it } from "vitest";
import { patchesByTags } from "../src/audio/patches/byTags";
import { listPatchesFor } from "../src/audio/patches/patchTools";

describe("patchesByTags (AGENT-4.16): patches found by what they sound like", () => {
  it("finds the patches carrying the tags, best match first", () => {
    const found = patchesByTags(["Bright", "glassy"]);
    expect(found.patches[0].name).toBe("Morph Keys"); // bright and glassy both
    expect(found.patches.every((patch) => patch.tags.some((tag) => ["bright", "glassy"].includes(tag)))).toBe(true);
    expect(found).not.toHaveProperty("unknown");
  });

  it("counts an instrument's default settings as its patch", () => {
    expect(patchesByTags(["warm"]).defaults.map((entry) => entry.instrument)).toContain("micro-va");
  });

  it("answers a word that isn't a tag with the tags there are", () => {
    const found = patchesByTags(["haunting"]);
    expect(found.unknown).toEqual(["haunting"]);
    expect(found.knownTags).toEqual(expect.arrayContaining(["bright", "warm"]));
  });

  it("is what list_patches gives for tags, and every patch without them", () => {
    expect(listPatchesFor({ tags: ["bass"] })).toMatchObject({ patches: expect.any(Array) });
    expect(Array.isArray(listPatchesFor({}))).toBe(true);
  });
});
