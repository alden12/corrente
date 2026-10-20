import { describe, expect, it } from "vitest";
import {
  exploreItems,
  favouriteItems,
  groupByCategory,
  hasTags,
  rankTags,
  tagsIn,
  type ExploreItem,
} from "../src/ui/explore/exploreItems";
import { pickableInstrumentInfos } from "../src/audio/instruments/catalog";
import { search } from "../src/audio/search";
import { effectInfos } from "../src/audio/effects/catalog";
import { midiDeviceInfos } from "../src/audio/midi/device/catalog";
import { FACTORY_PATCHES } from "../src/audio/patches/factory";
import type { Patch } from "../src/audio/patches/library";
import { registerInstrument, unregisterInstrument } from "../src/audio/instruments/catalog";

const saved: Patch = {
  id: "mine",
  name: "My Bass",
  author: "you",
  instrumentType: "nimbus",
  params: {},
  effects: [],
  createdAt: 1,
};

const items = exploreItems({ savedPatches: [saved], samples: [{ id: "kick", name: "Kick 01" }] });
const named = (name: string) => items.find((item) => item.name === name) as ExploreItem;

describe("exploreItems", () => {
  it("iterates the catalogs rather than listing devices", () => {
    const count = (category: ExploreItem["category"]) => items.filter((item) => item.category === category).length;
    expect(count("instruments")).toBe(pickableInstrumentInfos().length);
    expect(count("effects")).toBe(effectInfos().length);
    expect(count("midi")).toBe(midiDeviceInfos().length);
    expect(count("patches")).toBe(FACTORY_PATCHES.length + 1);
    expect(count("samples")).toBe(1);
  });

  it("tags every built-in, so none is invisible to a tag filter", () => {
    const untagged = items.filter((item) => item.builtin && item.tags.length === 0).map((item) => item.name);
    expect(untagged).toEqual([]);
  });

  it("marks what is yours as not built-in", () => {
    expect(named("My Bass").builtin).toBe(false);
    expect(named("Kick 01").builtin).toBe(false);
    expect(named("Reverb").builtin).toBe(true);
  });
});

describe("custom devices", () => {
  it("are not marked built-in", () => {
    registerInstrument({ type: "agent-fizz", label: "Fizz", schema: [], family: "Custom", custom: true });
    try {
      const fizz = exploreItems({ savedPatches: [], samples: [] }).find((item) => item.name === "Fizz");
      expect(fizz?.builtin).toBe(false);
      expect(fizz?.meta).toBe("Instrument · custom");
    } finally {
      unregisterInstrument("agent-fizz");
    }
  });
});

describe("searching Explore (search.ts)", () => {
  const found = (items: ExploreItem[], query: string) => search(items, query).items.map((item) => item.name);

  it("matches a name or a tag, every word", () => {
    expect(found([named("Glass Pad")], "glass")).toEqual(["Glass Pad"]);
    expect(found([named("Glass Pad")], "airy")).toEqual(["Glass Pad"]);
    expect(found([named("Glass Pad")], "glass bass")).toEqual([]);
  });

  it("matches only tags for a #word", () => {
    expect(found([named("Deep Sub")], "#bass")).toEqual(["Deep Sub"]);
    // "My Bass" has bass in its name but no tag.
    expect(found([named("My Bass")], "#bass")).toEqual([]);
    expect(found([named("My Bass")], "bass")).toEqual(["My Bass"]);
  });

  it("reads a misspelt word as the nearest tag or name word listed, and says so", () => {
    const items = exploreItems({ savedPatches: [], samples: [] });
    const glassy = search(items, "glasy");
    expect(glassy.readAs).toEqual({ glasy: "glassy" });
    expect(glassy.items.every((item) => item.tags.includes("glassy"))).toBe(true);
    expect(search(items, "nimbs").readAs).toEqual({ nimbs: "nimbus" });
    expect(search(items, "#glasy").readAs).toEqual({ "#glasy": "#glassy" });
    // Like nothing at all: left as typed, so nothing is found.
    expect(search(items, "zzqx")).toEqual({ items: [] });
  });
});

describe("tagsIn", () => {
  it("offers only tags that something carries, in vocabulary order", () => {
    expect(tagsIn([named("Reverb"), named("Distortion")])).toEqual(["space", "gritty", "airy", "lush", "aggressive"]);
    expect(tagsIn([named("Kick 01")])).toEqual([]);
  });
});

describe("tags outside the known vocabulary", () => {
  const custom: ExploreItem = { ...named("Glass Pad"), key: "custom", tags: ["pad", "shoegaze", "airy"] };

  it("are offered, after the known ones", () => {
    expect(tagsIn([custom])).toEqual(["pad", "airy", "shoegaze"]);
  });

  it("are searchable and filterable like any other", () => {
    expect(search([custom], "#shoe").items).toEqual([custom]);
    expect(hasTags(custom, ["shoegaze"])).toBe(true);
  });
});

describe("rankTags", () => {
  const item = (name: string, tags: ExploreItem["tags"]): ExploreItem => ({
    key: name,
    category: "patches",
    name,
    meta: "",
    tags,
    builtin: true,
    source: { kind: "instrument", type: name },
  });
  const list = [
    item("a", ["bass", "warm", "retro"]),
    item("b", ["bass", "warm", "bright"]),
    item("c", ["pad", "warm"]),
    item("d", ["pad", "warm", "dark"]),
  ];

  it("leads with the tags that split the list most evenly, and drops ones that split nothing", () => {
    // bass and pad cut it 2/2; retro, bright and dark 1/3; warm is on everything, so narrows nothing.
    expect(rankTags(list, [])).toEqual(["bass", "pad", "bright", "dark", "retro"]);
  });

  it("caps the row", () => {
    expect(rankTags(list, [], 2)).toEqual(["bass", "pad"]);
  });

  it("keeps picked tags first, and re-ranks over what they leave", () => {
    const left = list.filter((each) => hasTags(each, ["bass"]));
    expect(rankTags(left, ["bass"])).toEqual(["bass", "bright", "retro"]);
  });
});

describe("search results (COMM-1.9.3)", () => {
  const items = exploreItems({ savedPatches: [saved], samples: [{ id: "s1", name: "Kick" }] });

  it("groups results in tile order, A to Z within each, with no empty groups", () => {
    const groups = groupByCategory(search(items, "bass").items);
    const order = ["instruments", "patches", "effects", "midi", "samples"];
    const categories = groups.map((group) => group.category);
    expect(categories).toEqual([...categories].sort((left, right) => order.indexOf(left) - order.indexOf(right)));
    groups.forEach((group) => {
      expect(group.items.length).toBeGreaterThan(0);
      const names = group.items.map((item) => item.name);
      expect(names).toEqual(
        [...names].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
      );
    });
    expect(categories).toContain("patches");
  });

  it("lets built-ins and saved patches be hearted, not a project's samples", () => {
    const byKey = new Map(items.map((item) => [item.key, item]));
    expect(byKey.get("patch:mine")?.favouritable).toBe(true);
    expect(byKey.get("instrument:fm")?.favouritable).toBe(true);
    expect(byKey.get("sample:s1")?.favouritable).toBe(false);
  });

  it("lists favourites in the order given, skipping refs with no item", () => {
    const listed = favouriteItems(items, ["effect:reverb", "instrument:gone", "sample:s1", "instrument:fm"]);
    expect(listed.map((item) => item.key)).toEqual(["effect:reverb", "instrument:fm"]);
  });
});
