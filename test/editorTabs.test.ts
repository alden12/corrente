import { describe, expect, it } from "vitest";
import {
  NO_TABS,
  TAB_LIMIT,
  closeTab,
  keepActive,
  keepTab,
  openTab,
  parseTabs,
  retainTabs,
  showTab,
  tabKey,
  type EditorTabs,
} from "../src/ui/tabs/editorTabs";

/** The desktop's editor tabs (DAW-89): a preview tab, kept tabs, a limit, closing and saving. */

const track = (trackId: string) => ({ kind: "track" as const, trackId });
/** Each tab as its track, with a * for the preview and [] round the shown one. */
const shape = (state: EditorTabs) =>
  state.tabs.map((tab) => {
    const id = tab.target.kind === "track" ? tab.target.trackId : `${tab.target.type} graph`;
    const name = `${id}${tab.preview ? "*" : ""}`;
    return tabKey(tab.target) === state.active ? `[${name}]` : name;
  });
/** Show each track in turn. */
const showAll = (state: EditorTabs, ...ids: string[]) =>
  ids.reduce((current, id) => showTab(current, track(id)), state);

describe("editor tabs", () => {
  it("shows each selection in the one preview tab, replacing the last", () => {
    expect(shape(showAll(NO_TABS, "a"))).toEqual(["[a*]"]);
    expect(shape(showAll(NO_TABS, "a", "b", "c"))).toEqual(["[c*]"]);
  });

  it("keeps a tab, after which the next selection opens a new preview beside it", () => {
    const kept = keepActive(showAll(NO_TABS, "a"));
    expect(shape(kept)).toEqual(["[a]"]);
    expect(shape(showAll(kept, "b", "c"))).toEqual(["a", "[c*]"]);
  });

  it("goes back to an open tab rather than opening it again", () => {
    const state = showAll(keepActive(showAll(NO_TABS, "a")), "b", "a");
    expect(shape(state)).toEqual(["[a]", "b*"]);
    expect(keepTab(state, "track:b").tabs[1].preview).toBe(false);
  });

  it("closes a tab, showing its right-hand neighbour, else its left", () => {
    const three = ["a", "b", "c"].reduce((state, id) => keepActive(showTab(state, track(id))), NO_TABS);
    const onB = showTab(three, track("b"));
    expect(shape(closeTab(onB, "track:b"))).toEqual(["a", "[c]"]);
    expect(shape(closeTab(three, "track:c"))).toEqual(["a", "[b]"]);
    expect(shape(closeTab(onB, "track:a"))).toEqual(["[b]", "c"]);
    expect(shape(closeTab(showAll(NO_TABS, "a"), "track:a"))).toEqual([]);
  });

  it(`keeps at most ${TAB_LIMIT}, closing the one used longest ago and never the one shown`, () => {
    const ids = Array.from({ length: TAB_LIMIT + 2 }, (_, index) => `t${index}`);
    // Each kept as it's shown; t0 is shown again near the end, so it's no longer the oldest.
    const state = [...ids.slice(0, -1), "t0", ids.at(-1)!].reduce(
      (current, id) => keepActive(showTab(current, track(id))),
      NO_TABS,
    );
    expect(state.tabs).toHaveLength(TAB_LIMIT);
    expect(shape(state)).not.toContain("t1");
    expect(shape(state)).not.toContain("t2");
    expect(shape(state)).toContain("t0");
    expect(state.active).toBe(`track:${ids.at(-1)}`);
  });

  it("drops the tabs of tracks that are gone", () => {
    const state = showAll(keepActive(showAll(NO_TABS, "a")), "b");
    expect(shape(retainTabs(state, (target) => target.trackId !== "b"))).toEqual(["a"]);
    expect(retainTabs(state, () => true)).toBe(state);
  });

  it("opens a graph as a kept tab at the end, leaving the preview where it is", () => {
    const graph = { kind: "graph" as const, device: "instrument" as const, type: "fm" };
    const state = openTab(showAll(keepActive(showAll(NO_TABS, "a")), "b"), graph);
    expect(shape(state)).toEqual(["a", "b*", "[fm graph]"]);
    // Selecting another track replaces the preview, not the graph; opening the graph again goes to it.
    expect(shape(showAll(state, "c"))).toEqual(["a", "[c*]", "fm graph"]);
    expect(shape(openTab(showAll(state, "c"), graph))).toEqual(["a", "c*", "[fm graph]"]);
    expect(parseTabs(JSON.stringify(state))).toEqual(state);
  });

  it("reads back what it saved, and nothing from what doesn't read", () => {
    const state = showAll(keepActive(showAll(NO_TABS, "a")), "b");
    expect(parseTabs(JSON.stringify(state))).toEqual(state);
    expect(parseTabs(null)).toEqual(NO_TABS);
    expect(parseTabs("not json")).toEqual(NO_TABS);
    expect(parseTabs(JSON.stringify({ tabs: [{ target: { kind: "track" } }], active: null }))).toEqual(NO_TABS);
  });
});
