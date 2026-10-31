/**
 * The desktop's editor tabs (DAW-89): a remembered list of what you've had open, each a link. Opening
 * a tab is the same as selecting its track. Pure: `useEditorTabs` keeps the list per project and
 * follows the selection.
 *
 * **A preview tab**, as VS Code has: selecting something shows it in the one preview tab, which the
 * next selection replaces, so tabs don't pile up as you click around. It becomes a kept tab when you
 * double-click it or edit what it shows.
 *
 * **A limit:** past `TAB_LIMIT`, the tab used longest ago closes, never the one you're on.
 *
 * A tab is a track's editor or **a graph** (INST-44), opened from a menu as a kept tab: a device's, a
 * track's whole chain (INST-44.2), or a saved patch's chain, carried in the tab since a patch can't
 * change under it.
 */
import { z } from "zod";
import type { ChainEntry, DeviceKind } from "../../audio/definitions/chainGraph";

/** What a tab shows: a track's editor, a device's graph by its type, or a track's or a patch's chain. */
export type TabTarget =
  | { kind: "track"; trackId: string }
  | { kind: "graph"; device: DeviceKind; type: string }
  | { kind: "chain"; trackId: string }
  | { kind: "patch"; patchId: string; name: string; chain: ChainEntry[] };

const KEYS: { [Kind in TabTarget["kind"]]: (target: Extract<TabTarget, { kind: Kind }>) => string } = {
  track: (target) => `track:${target.trackId}`,
  graph: (target) => `graph:${target.type}`,
  chain: (target) => `chain:${target.trackId}`,
  patch: (target) => `patch:${target.patchId}`,
};

export interface Tab {
  target: TabTarget;
  /** The preview tab, which the next selection replaces. */
  preview: boolean;
  /** When it was last shown, as a count that goes up with each showing: past the limit, the lowest closes. */
  usedAt: number;
}

export interface EditorTabs {
  tabs: Tab[];
  /** The tab shown, by key, or none. */
  active: string | null;
}

/** How many tabs stay open: past this, the one used longest ago closes. */
export const TAB_LIMIT = 10;

export const NO_TABS: EditorTabs = { tabs: [], active: null };

/** Each track open in a kept tab, in order, with `active`'s shown: how the starter project opens (DAW-94). */
export const trackTabs = (trackIds: readonly string[], active: string | null): EditorTabs => ({
  tabs: trackIds.map((trackId, index) => ({ target: { kind: "track", trackId }, preview: false, usedAt: index + 1 })),
  active: active ? tabKey({ kind: "track", trackId: active }) : null,
});

/** A tab's identity: two tabs on the same target are the same tab. */
export const tabKey = (target: TabTarget): string => (KEYS[target.kind] as (target: TabTarget) => string)(target);

const activeTab = (state: EditorTabs): Tab | undefined => state.tabs.find((tab) => tabKey(tab.target) === state.active);

/** The list cut back to `TAB_LIMIT`, closing the tabs used longest ago, never the active one. */
const limited = (state: EditorTabs): EditorTabs => {
  const extra = state.tabs.length - TAB_LIMIT;
  if (extra <= 0) return state;
  const closing = new Set(
    state.tabs
      .filter((tab) => tabKey(tab.target) !== state.active)
      .toSorted((first, second) => first.usedAt - second.usedAt)
      .slice(0, extra),
  );
  return { ...state, tabs: state.tabs.filter((tab) => !closing.has(tab)) };
};

/** The next showing's count: one past the latest. */
const nextUse = (state: EditorTabs): number => Math.max(0, ...state.tabs.map((tab) => tab.usedAt)) + 1;

/**
 * Show `target`: its tab if it has one, else in the preview tab (replacing what was previewed there),
 * or a new preview tab at the end if there's none.
 */
export function showTab(state: EditorTabs, target: TabTarget): EditorTabs {
  const key = tabKey(target);
  const now = nextUse(state);
  if (state.tabs.some((tab) => tabKey(tab.target) === key)) {
    return {
      tabs: state.tabs.map((tab) => (tabKey(tab.target) === key ? { ...tab, usedAt: now } : tab)),
      active: key,
    };
  }
  const opened: Tab = { target, preview: true, usedAt: now };
  const previewAt = state.tabs.findIndex((tab) => tab.preview);
  const tabs = previewAt >= 0 ? state.tabs.with(previewAt, opened) : [...state.tabs, opened];
  return limited({ tabs, active: key });
}

/** Open `target` as a kept tab, at the end (or go to it, if it's open), as a menu's "View graph" does. */
export function openTab(state: EditorTabs, target: TabTarget): EditorTabs {
  const key = tabKey(target);
  if (state.tabs.some((tab) => tabKey(tab.target) === key)) return showTab(state, target);
  return limited({ tabs: [...state.tabs, { target, preview: false, usedAt: nextUse(state) }], active: key });
}

/** Keep the tab `key` (no longer the preview), as a double-click or an edit in it does. */
export function keepTab(state: EditorTabs, key: string): EditorTabs {
  const tab = state.tabs.find((each) => tabKey(each.target) === key);
  if (!tab?.preview) return state;
  return { ...state, tabs: state.tabs.map((each) => (each === tab ? { ...each, preview: false } : each)) };
}

/** Keep the tab shown, if it's the preview. */
export const keepActive = (state: EditorTabs): EditorTabs =>
  state.active && activeTab(state)?.preview ? keepTab(state, state.active) : state;

/** Close the tab `key`. Closing the one shown shows its right-hand neighbour, else its left. */
export function closeTab(state: EditorTabs, key: string): EditorTabs {
  const at = state.tabs.findIndex((tab) => tabKey(tab.target) === key);
  if (at < 0) return state;
  const tabs = state.tabs.toSpliced(at, 1);
  if (state.active !== key) return { ...state, tabs };
  const neighbour = tabs[at] ?? tabs[at - 1];
  return { tabs, active: neighbour ? tabKey(neighbour.target) : null };
}

/** Close every tab but `key`, which is shown. */
export function closeOtherTabs(state: EditorTabs, key: string): EditorTabs {
  const kept = state.tabs.filter((tab) => tabKey(tab.target) === key);
  return kept.length > 0 ? { tabs: kept, active: key } : state;
}

/** Only the tabs whose target still `exists` (a deleted track's go); the shown one, if it went, is none. */
export function retainTabs(state: EditorTabs, exists: (target: TabTarget) => boolean): EditorTabs {
  const tabs = state.tabs.filter((tab) => exists(tab.target));
  if (tabs.length === state.tabs.length) return state;
  const active = tabs.some((tab) => tabKey(tab.target) === state.active) ? state.active : null;
  return { tabs, active };
}

const deviceKind = z.enum(["midi", "instrument", "effect"]);

/** The saved list, checked as it's read back: anything that doesn't read is no tabs. */
const savedTabs = z.object({
  tabs: z.array(
    z.object({
      target: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("track"), trackId: z.string() }),
        z.object({ kind: z.literal("graph"), device: deviceKind, type: z.string() }),
        z.object({ kind: z.literal("chain"), trackId: z.string() }),
        z.object({
          kind: z.literal("patch"),
          patchId: z.string(),
          name: z.string(),
          chain: z.array(z.object({ kind: deviceKind, type: z.string(), bypassed: z.boolean().optional() })),
        }),
      ]),
      preview: z.boolean(),
      usedAt: z.number(),
    }),
  ),
  active: z.string().nullable(),
});

export const parseTabs = (text: string | null): EditorTabs => {
  if (!text) return NO_TABS;
  try {
    const parsed = savedTabs.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : NO_TABS;
  } catch {
    return NO_TABS;
  }
};
