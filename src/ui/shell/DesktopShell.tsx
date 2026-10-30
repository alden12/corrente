/**
 * The desktop shell: the video-editor spine (activity rail + library | center, with the
 * arrangement timeline as a full-width band along the bottom). The agent is one of the rail's views
 * (DAW-87), opening in the library's place, and the app's status sits at the rail's foot. Lifted out of
 * `AppShell` when the touch shell arrived (MOBILE-1) - `AppShell` owns the stores and
 * the engine, and each shell is a pure layout over `ShellProps`.
 *
 * Everything private to this file is geometry: the two resizable, persisted splits
 * and the measured body height that keeps the timeline from crowding out the workbench.
 */
import { useSongKey } from "../pads/songKey";
import { currentProjectId } from "../../audio/projectRepository";
import { exportProjectFile } from "../projectFile";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityRail } from "../ActivityRail";
import { LibraryPanel } from "../LibraryPanel";
import { CenterWorkbench } from "../CenterWorkbench";
import { AgentPanel } from "../AgentPanel";
import { RailIndicators } from "../RailIndicators";
import { ArrangementTimeline } from "../ArrangementTimeline";
import { ResizeHandle } from "../ResizeHandle";
import { usePersistentNumber, usePersistentString } from "../usePersistent";
import type { ShellProps } from "./types";
import {
  EXPLORE_PAGE_KEY,
  EXPLORE_PAGES,
  openExplorePage,
  requestExploreSearch,
  type ExplorePage,
} from "../explore/explorePage";
import { CATEGORIES } from "../explore/exploreItems";
import { CategoryGlyph } from "../explore/ExploreThumb";
import { setFromExplore } from "../explore/fromExplore";
import { EXPLORE_SHORTCUTS } from "../libraryViews";
import { openProjectsPage } from "../projects/projectsPage";
import { KeysPanel } from "../keys/KeysPanel";
import { useDesktopKeys } from "../keys/useDesktopKeys";

// Layout bounds. The activity rail is always shown on the left; the panel beside it (the library's
// views, or the agent) collapses to that rail. The timeline can grow until only MIN_CENTER of the
// workbench remains.
const RAIL_WIDTH = 48;
const MIN_CENTER = 96;

/** What the middle column keeps on a first open, before the side panel gets more. */
const MIDDLE_MIN = 560;
const PANEL_WIDTH = 350;

/** The side panel's width on a first open: 350px, less on a window too small for it. */
const readOpeningPanelWidth = (): number =>
  Math.max(150, Math.min(PANEL_WIDTH, window.innerWidth - RAIL_WIDTH - MIDDLE_MIN));

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function DesktopShell({
  projectStore,
  scheduler,
  recorder,
  editLog,
  versionStore,
  dispatch,
  liveNotes,
  preview,
  projectId,
  selectedTrack,
  isPlaying,
  started,
  mcpStatus,
  syncStatus,
  syncShared,
  hasApiKey,
  libView,
  onSelectView,
  libCollapsed,
  onToggleLibCollapsed,
  onOpenAgentSettings,
  onOpenSettings,
  onOpenShare,
  onOpenTiming,
  onOpenEditorColors,
}: ShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // A first open gives the side panel 350px, or less on a small window so the middle keeps
  // MIDDLE_MIN; a width you've dragged to is kept as it is.
  // Read on every resize, so a panel you haven't sized follows the window rather than catching up
  // on the next redraw.
  const opening = useSyncExternalStore(subscribeResize, readOpeningPanelWidth);
  const [libWidth, setLibWidth] = usePersistentNumber("corrente:lib-width", opening, 150, 620);
  const [timelineH, setTimelineH] = usePersistentNumber("corrente:timeline-height", 244, 120, 2000);
  const [dragging, setDragging] = useState(false);
  // The computer keyboard, played in key (DAW-12.1). Here rather than in the piano roll that shows
  // it, so the keys play whatever the workbench is showing.
  const keys = useDesktopKeys(liveNotes, started, useSongKey(projectStore, dispatch));

  // Track the body height so the timeline can never crowd out the workbench:
  // the effective height is clamped to leave at least MIN_CENTER up top, which
  // also heals a stale/oversized persisted value and adapts on window resize.
  const [bodyH, setBodyH] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setBodyH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effTimelineH = bodyH ? Math.min(timelineH, bodyH - MIN_CENTER) : timelineH;
  // The rail is its own full-height column (spans both rows), then the side panel (collapses to 0)
  // and the center. `libColRight` is the panel's right edge (rail + panel), where its resize handle sits.
  const libColRight = RAIL_WIDTH + (libCollapsed ? 0 : libWidth);
  const gridCols = `${RAIL_WIDTH}px ${libCollapsed ? 0 : libWidth}px minmax(0, 1fr)`;
  const gridRows = `minmax(0, 1fr) ${effTimelineH}px`;
  const bodyRect = () => bodyRef.current?.getBoundingClientRect();
  const bodyLeft = () => bodyRect()?.left ?? 0;
  const revealProject = () => {
    openProjectsPage("inside");
    onSelectView("project");
  };
  // Explore's buttons to your projects mark the trip, so Projects offers the way back (`fromExplore`).
  const exploreLinks = {
    mcpStatus,
    onOpenProject: () => {
      revealProject();
      setFromExplore(true);
    },
    onOpenProjects: () => {
      onSelectView("project");
      openProjectsPage("home");
      setFromExplore(true);
    },
    onBackToExplore: () => onSelectView("explore"),
  };
  const [explorePage] = usePersistentString<ExplorePage>(EXPLORE_PAGE_KEY, "home", EXPLORE_PAGES);
  const exploreShortcuts = EXPLORE_SHORTCUTS.map((page) => ({
    label: CATEGORIES[page].label,
    icon: <CategoryGlyph category={page} size={16} />,
    selected: libView === "explore" && !libCollapsed && explorePage === page,
    // The view first: selecting Explore again resets it to home, which the page then replaces.
    onSelect: () => {
      onSelectView("explore");
      openExplorePage(page);
    },
  }));

  return (
    <div
      ref={bodyRef}
      className="app-body flex-1 min-h-0 relative"
      style={{
        gridTemplateColumns: gridCols,
        gridTemplateRows: gridRows,
        transition: dragging ? "none" : undefined,
      }}
    >
      <ActivityRail
        active={libView}
        collapsed={libCollapsed}
        onSelect={onSelectView}
        onOpenSettings={onOpenSettings}
        shortcuts={exploreShortcuts}
        onSearch={() => {
          onSelectView("explore");
          requestExploreSearch();
        }}
        indicators={
          <RailIndicators
            mcpStatus={mcpStatus}
            syncStatus={syncStatus}
            syncShared={syncShared}
            onRevealProject={revealProject}
            backupReminder={{
              editLog,
              onExport: () =>
                void exportProjectFile(currentProjectId(), projectStore.name, { projectStore, editLog }).catch(
                  (error: unknown) => console.warn("[corrente] export failed:", error),
                ),
            }}
          />
        }
      />
      {!libCollapsed && libView === "agent" && (
        <div className="[grid-area:library] min-w-0 min-h-0 flex border-r border-line">
          <AgentPanel
            onCollapse={onToggleLibCollapsed}
            projectStore={projectStore}
            dispatch={dispatch}
            scheduler={scheduler}
            hasApiKey={hasApiKey}
            onOpenAgentSettings={onOpenAgentSettings}
          />
        </div>
      )}
      {!libCollapsed && libView !== "agent" && (
        <LibraryPanel
          projectStore={projectStore}
          editLog={editLog}
          versionStore={versionStore}
          dispatch={dispatch}
          activeView={libView}
          onOpenShare={onOpenShare}
          onOpenTiming={onOpenTiming}
          preview={preview}
          recorder={recorder}
          exploreLinks={exploreLinks}
          onCollapse={onToggleLibCollapsed}
        />
      )}
      {/* Remade for another project: its tabs are that project's. */}
      <CenterWorkbench
        key={projectId ?? "none"}
        projectId={projectId}
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        selectedTrack={selectedTrack}
        onRevealSamples={() => {
          onSelectView("explore");
          openExplorePage("samples");
        }}
        keys={{ panel: <KeysPanel {...keys.panel} />, height: keys.height, open: keys.panel.open }}
        onOpenEditorColors={onOpenEditorColors}
      />
      <ArrangementTimeline
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        isPlaying={isPlaying}
        started={started}
      />

      {!libCollapsed && (
        <ResizeHandle
          ariaLabel="Resize library"
          onDragChange={setDragging}
          onResize={(x) => setLibWidth(x - bodyLeft() - RAIL_WIDTH)}
          style={{ left: libColRight - 3, top: 0, bottom: effTimelineH }}
        />
      )}
      <ResizeHandle
        ariaLabel="Resize timeline"
        orientation="horizontal"
        onDragChange={setDragging}
        onResize={(y) => {
          const rect = bodyRect();
          if (rect) setTimelineH(Math.min(rect.height - MIN_CENTER, rect.bottom - y));
        }}
        // Sit fully above the timeline's top edge, not straddling it, so it never
        // covers the ruler's loop-region markers (which would steal their drags).
        // Starts after the full-height rail (the timeline no longer spans it).
        style={{ left: RAIL_WIDTH, right: 0, bottom: effTimelineH }}
      />
    </div>
  );
}
