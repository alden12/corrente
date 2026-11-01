/**
 * The library view set, as data: one entry per view, carrying its label and glyph.
 *
 * Its own module because two layouts render it - the desktop `ActivityRail` as a
 * vertical icon column, and the touch shell's horizontal strip (MOBILE-1) - so adding
 * a view stays a single entry rather than a change in each shell. (It also has to be
 * separate from the components that consume it: a module mixing constant and component
 * exports breaks React Fast Refresh.)
 */
import type { ReactNode } from "react";
import { AgentIcon } from "./shellIcons";
import type { ExploreCategory } from "./explore/exploreItems";
import type { ProjectsPage } from "./projects/projectsPage";

/** The one library view on show. Persisted, so it survives a reload. */
export type LibraryView = "project" | "explore" | "activity" | "agent";

/**
 * The views the library panel draws. The agent (DAW-87) is a rail view too, but the desktop shell
 * opens its own panel in the library's place, and the phone opens it as a sheet.
 */
export type PanelView = Exclude<LibraryView, "agent">;

export interface RailItem {
  view: LibraryView;
  /** Projects' page it opens, where the view has two: the list, or the open project's tree. */
  page?: ProjectsPage;
  label: string;
  icon: ReactNode;
}

// 16px line icons (stroke = currentColor), matching the app's minimal glyph style.
const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4.5 h-4.5"
  >
    {children}
  </svg>
);

/** In rail order, top to bottom: Explore first, as the place you start from (and the default view). */
export const RAIL_ITEMS: RailItem[] = [
  // Cards and tiles, not a compass: it says what is in there rather than that you may wander.
  {
    view: "explore",
    label: "Explore",
    icon: svg(
      <>
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
      </>,
    ),
  },
  // Projects and the open project are one view, two pages, but each its own icon on the desktop rail
  // (2026-11-01): a stack of folders for the list, and the tree the project page now is.
  {
    view: "project",
    page: "home",
    label: "Projects",
    icon: svg(
      <>
        <path d="M4.5 4V3.5a1 1 0 0 1 1-1h2.2l1.2 1.2h3.6a1 1 0 0 1 1 1v6" />
        <path d="M2 6.5a1 1 0 0 1 1-1h2.2l1.2 1.2h3.6a1 1 0 0 1 1 1v4.8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
      </>,
    ),
  },
  {
    view: "project",
    page: "inside",
    label: "Project",
    icon: svg(
      <>
        <rect x="2" y="2" width="5" height="3.5" rx="1" />
        <path d="M4.5 5.5v7h4M4.5 8h4" />
        <rect x="8.5" y="6.5" width="5.5" height="3" rx="1" />
        <rect x="8.5" y="11" width="5.5" height="3" rx="1" />
      </>,
    ),
  },
  { view: "activity", label: "Activity", icon: svg(<path d="M2 8h3l2-4 2 8 2-6 1.5 2H14" />) },
  { view: "agent", label: "Agent", icon: <AgentIcon className="w-4.5 h-4.5" /> },
];

/**
 * Shortcuts under Explore on the desktop rail (COMM-3): straight to the page for a kind of device,
 * then patches, favourites and samples, where otherwise it is Explore and then its tile. Devices
 * first, the order Alden picked (2026-10-30). Each is drawn with its tile's glyph, under its label.
 */
export const EXPLORE_SHORTCUTS: readonly ExploreCategory[] = [
  "instruments",
  "effects",
  "midi",
  "patches",
  "favourites",
  "samples",
];
