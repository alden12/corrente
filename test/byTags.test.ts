import { describe, expect, it } from "vitest";
import { patchesByTags } from "../src/audio/patches/byTags";
import { FACTORY_PATCHES } from "../src/audio/patches/factory";
import { listPatchesFor } from "../src/audio/patches/patchTools";
import type { Patch } from "../src/audio/patches/library";
import { parseTags } from "../src/audio/tags";
import { nearestTags, resolveTags, similarity } from "../src/audio/tagMatch";

const mine = (count: number): Patch[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `pt-${index}`,
    name: `Mine ${index}`,
    author: "you",
    instrumentType: "subtractive",
    params: {},
    effects: [],
    createdAt: index,
    tags: ["pad", "shimmery"],
  }));

describe("patchesByTags (AGENT-4.16): patches found by what they sound like", () => {
  it("finds the patches carrying the tags, best match first", () => {
    const found = patchesByTags(["Bright", "glassy"], FACTORY_PATCHES);
    expect(found.patches[0].name).toBe("Morph Keys"); // bright and glassy both
    expect(found.patches.every((patch) => patch.tags.some((tag) => ["bright", "glassy"].includes(tag)))).toBe(true);
    expect(found).not.toHaveProperty("unknown");
  });

  it("counts an instrument's default settings as its patch", () => {
    expect(patchesByTags(["warm"], FACTORY_PATCHES).defaults?.map((entry) => entry.instrument)).toContain("micro-va");
  });

  it("reads a misspelt tag as the nearest one, and says so", () => {
    const found = patchesByTags(["glasy"], FACTORY_PATCHES);
    expect(found.readAs).toEqual({ glasy: "glassy" });
    expect(found.patches.length).toBeGreaterThan(0);
  });

  it("answers a word like no tag with the most used tags", () => {
    const found = patchesByTags(["haunting"], FACTORY_PATCHES);
    expect(found.unknown).toEqual(["haunting"]);
    expect(found.knownTags).toEqual(expect.arrayContaining(["bright", "warm"]));
  });

  it("is what list_patches gives, a page at a time, and only the user's with `mine`", () => {
    const own = mine(60);
    expect(listPatchesFor({ tags: ["bass"] }, [])).toMatchObject({ patches: expect.any(Array) });
    const first = listPatchesFor({ mine: true }, own);
    expect(first.patches).toHaveLength(50);
    expect(first.next).toBe("50");
    const rest = listPatchesFor({ mine: true, cursor: first.next }, own);
    expect(rest.patches).toHaveLength(10);
    expect(rest).not.toHaveProperty("next");
    // Only theirs, and no instruments' defaults.
    const tagged = listPatchesFor({ mine: true, tags: ["shimery"], limit: 5 }, own);
    expect(tagged).toMatchObject({ readAs: { shimery: "shimmery" }, next: "5" });
    expect(tagged).not.toHaveProperty("defaults");
  });
});

describe("tag matching: pg_trgm's similarity, written out", () => {
  it("scores as Postgres does", () => {
    // Postgres 16's own similarity() for each pair, measured.
    expect(similarity("glassy", "glassy")).toBe(1);
    expect(similarity("glasy", "glassy")).toBeCloseTo(0.625, 6);
    expect(similarity("shimery", "shimmery")).toBeCloseTo(0.7, 6);
    expect(similarity("lo-fi", "lofi")).toBeCloseTo(0.375, 6);
    expect(similarity("Warm Pad", "pad")).toBeCloseTo(0.4444444, 6);
    expect(similarity("pad", "bass")).toBe(0);
  });

  it("finds the nearest tags past pg_trgm's threshold, best first", () => {
    expect(nearestTags("glasy", ["glassy", "gritty", "glass"])).toEqual(["glassy", "glass"]);
    expect(nearestTags("zzz", ["glassy"])).toEqual([]);
  });

  it("takes each word as itself, else as its nearest tag", () => {
    const tags = new Set(["pad", "glassy"]);
    expect(
      resolveTags(
        ["Pad", "glasy", "haunting"],
        (word) => tags.has(word),
        (word) => nearestTags(word, tags),
      ),
    ).toEqual({ tags: ["pad", "glassy"], readAs: { glasy: "glassy" }, unknown: ["haunting"] });
  });
});

describe("parseTags: tags typed as text", () => {
  it("splits on commas, trims, lower-cases and keeps each once", () => {
    expect(parseTags(" Pad, dark ,, pad,Eerie ")).toEqual(["pad", "dark", "eerie"]);
    expect(parseTags("")).toEqual([]);
  });
});
