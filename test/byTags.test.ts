import { describe, expect, it } from "vitest";
import { patchesByTags } from "../src/audio/patches/byTags";
import { listPatchesFor } from "../src/audio/patches/patchTools";
import { TAG_NOTES } from "../src/audio/tagNotes";
import { CATALOGUE } from "../src/audio/definitions/catalogue";

describe("tag notes (AGENT-4.16): the cookbook on tags", () => {
  it("build only with blocks the engine has", () => {
    const blocks = new Set(CATALOGUE.blocks.map((block) => block.name));
    const missing = Object.entries(TAG_NOTES).flatMap(([tag, note]) =>
      note.blocks.filter((block) => !blocks.has(block)).map((block) => `${tag}: ${block}`),
    );
    expect(missing).toEqual([]);
  });

  it("give each synonym one tag, and never a tag's own name", () => {
    const synonyms = Object.values(TAG_NOTES).flatMap((note) => note.synonyms);
    expect(new Set(synonyms).size).toBe(synonyms.length);
    expect(synonyms.filter((synonym) => synonym in TAG_NOTES)).toEqual([]);
  });
});

describe("patchesByTags: patches found by what they sound like", () => {
  it("finds the patches carrying a tag, best match first, with the tag's note", () => {
    const found = patchesByTags(["bright", "glassy"]);
    expect(found.patches[0].name).toBe("Morph Keys"); // bright and glassy both
    expect(found.patches.every((patch) => patch.tags.some((tag) => ["bright", "glassy"].includes(tag)))).toBe(true);
    expect(found.tags.map((entry) => entry.tag)).toEqual(["bright", "glassy"]);
    expect(found.tags[0]).toMatchObject({
      note: expect.stringMatching(/saw/),
      check: expect.stringMatching(/centroid/),
    });
    expect(found).not.toHaveProperty("unknown");
  });

  it("resolves a synonym to its tag, and counts an instrument's defaults as its patch", () => {
    const found = patchesByTags(["Vibrant"]);
    expect(found.tags.map((entry) => entry.tag)).toEqual(["bright"]);
    const warm = patchesByTags(["warm"]);
    expect(warm.defaults.map((entry) => entry.instrument)).toContain("micro-va");
  });

  it("answers a word it doesn't know with the words it does", () => {
    const found = patchesByTags(["squonky"]);
    expect(found.unknown).toEqual(["squonky"]);
    expect(found.knownTags).toEqual(expect.arrayContaining(["bright", "haunting"]));
  });

  it("is what list_patches gives for tags, and every patch without them", () => {
    expect(listPatchesFor({ tags: ["eerie"] })).toMatchObject({ tags: [{ tag: "eerie" }] });
    expect(Array.isArray(listPatchesFor({}))).toBe(true);
  });
});
