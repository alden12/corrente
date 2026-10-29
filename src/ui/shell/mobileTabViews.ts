/**
 * The touch shell's tabs and the library views each hosts (MOBILE-19), as data. Components are in
 * `MobileTabs.tsx`; this is separate so that file exports components only.
 */
import type { LibraryView, PanelView } from "../libraryViews";

export type MobileTab = "projects" | "explore" | "studio";
/** In bar order, left to right: the two places you work in, then your projects at the end. */
export const MOBILE_TABS: readonly MobileTab[] = ["explore", "studio", "projects"];

/**
 * The library views each non-Studio tab hosts. The first is where the tab opens. Search is
 * Explore's (COMM-1.9.3): its box finds your tracks as well as everything you can add.
 */
export const TAB_VIEWS = {
  projects: ["project", "activity"],
  explore: ["explore"],
} as const satisfies Record<Exclude<MobileTab, "studio">, readonly PanelView[]>;

export type BrowseTab = keyof typeof TAB_VIEWS;

export const isViewOf = (tab: BrowseTab, view: LibraryView) =>
  (TAB_VIEWS[tab] as readonly LibraryView[]).includes(view);
