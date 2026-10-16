/**
 * The touch shell (MOBILE-1, restructured by MOBILE-5), used on phones and tablets and on
 * any window too narrow for the desktop grid. Same stores, same leaf panels - only the
 * layout differs.
 *
 * **Mobile is the desktop occluded, not the desktop split four ways.** This used to be
 * four bottom tabs, on the argument that they were the desktop's own surfaces rather than
 * navigation invented for mobile. That argument was right and it pointed somewhere better:
 * the desktop does not tab between them either, it *stacks and occludes* -
 * `CenterWorkbench` is editor-above-rack floating over the timeline. So the arrangement is
 * simply the background here, and the editor is an `EditorSheet` over it, thrown between
 * three detents: minimised to a preview bar, half, and covering the workspace (MOBILE-19.1).
 *
 * That deleted three things rather than adding one: the tab bar (~56px of a phone, plus
 * the safe area), the `LaneStrip` special case (it existed only because the Edit tab took
 * the arrangement away), and the question of
 * where selection navigates to - it does not, because the arrangement never leaves.
 *
 * **That workspace is the Studio, one of three tabs** (MOBILE-19): Projects, Explore and
 * Studio, along the bottom (`MobileTabs.tsx`). They replaced the ☰ library panel, whose views
 * they now host between them. The Studio stays mounted while another tab is in front, so the
 * arrangement's scroll and the editor's state survive a look at the catalogue.
 *
 * **The agent** is a ✦ in the top bar, beside the account button: a sheet over the app on a
 * phone, a docked column on a tablet. It used to share the ☰ panel's column, and before that
 * was a second sheet; with the panel gone it is a button of its own again.
 *
 * The top bar keeps what you reach for mid-idea - record, play, undo, redo - plus the agent and
 * your account, and everything else is behind ⋮, above the project's tempo, meter and metronome.
 *
 * The sheet holds the desktop's own column (MOBILE-24): the clips line, the roll and the devices,
 * each a section that folds, scrolling as one. The keys dock under the Studio, above the tabs, as
 * a phone's own keyboard does (`NotePads`): they are what makes a phone able to *play* rather than
 * only arrange - and so what makes it able to record, since they go out through the same
 * `LiveNotes` seam a MIDI keyboard does.
 */
import { useRef, useState, type ReactNode } from "react";
import { LibraryPanel } from "../LibraryPanel";
import { AgentPanel } from "../AgentPanel";
import { ArrangementTimeline } from "../ArrangementTimeline";
import { TransportBar } from "../TransportBar";
import { AccountAvatar } from "../AccountAvatar";
import { Menu } from "../Menu";
import { IconButton } from "../controls/IconButton";
import { iconButtonClass } from "../controls/iconButtonStyle";
import type { LibraryView } from "../libraryViews";
import { WorkbenchColumn } from "../workbench/WorkbenchColumn";
import { NotePads } from "../pads/NotePads";
import { TOUCH_SECTION_HEADER_HEIGHT } from "../controls/SectionHeader";
import { ClipPreview } from "./ClipPreview";
import { beatsPerBar as beatsPerBarOf } from "../../audio/project/schema";
import { useProject } from "../../audio/project/useProject";
import { useEditLog } from "../../audio/commands/useEditLog";
import { usePersistentString } from "../usePersistent";
import { useElementHeight } from "../useElementHeight";
import { arrangementAddItems } from "../arrangement/addItems";
import { detentsFor, type Detent } from "./detents";
import { EditorSheet, SHEET_HEADER_HEIGHT } from "./EditorSheet";
import { Sheet } from "./Sheet";
import { atLeast, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from "./safeArea";
import { TabBar, ViewRail } from "./MobileTabs";
import { ProjectsHome } from "../projects/ProjectsHome";
import { BackToProjects } from "../projects/ProjectsPlace";
import { PROJECTS_PAGE_DEFAULT, PROJECTS_PAGE_KEY, PROJECTS_PAGES, type ProjectsPage } from "../projects/projectsPage";
import { openExplorePage } from "../explore/explorePage";
import { MOBILE_TABS, type BrowseTab, type MobileTab } from "./mobileTabViews";
import type { Track } from "../../audio/project/projectStore";
import type { ShellProps } from "./types";
import type { DeviceShape } from "./useDeviceShape";
import { UndoIcon } from "../shellIcons";
import { ProjectOverview } from "../projects/ProjectOverview";
import { ActivityView } from "../ActivityView";

/**
 * A top-bar icon button, sized for a finger rather than a cursor.
 *
 * Thin wrapper over `IconButton` so touch inherits the house rule (bare at rest, accent pill
 * when active) and the `lg` touch size in one place, rather than the bar keeping its own
 * palette. It exists only for the size default and `shrink-0` - a top bar that lets its
 * controls compress is a top bar that clips at 390px.
 */
function BarButton({
  label,
  onClick,
  active,
  disabled,
  tint,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tint?: "agent";
  children: ReactNode;
}) {
  return (
    <IconButton
      label={label}
      tone={tint === "agent" ? "agent" : "you"}
      size="lg"
      active={active}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0"
    >
      {children}
    </IconButton>
  );
}

/** The minimised sheet's glance: an instrument track's active clip, drawn; an audio clip by name. */
function sheetPreview(track: Track, beatsPerBar: number): ReactNode {
  if (track.kind === "instrument") {
    const active = track.clips.find((clip) => clip.id === track.activeClipId) ?? track.clips[0];
    return active && <ClipPreview store={active.store} name={active.name} beatsPerBar={beatsPerBar} />;
  }
  const active = track.clips.find((clip) => clip.id === track.activeClipId) ?? track.clips[0];
  return active && <span className="block px-2 truncate font-mono text-[10px] text-faint">{active.name}</span>;
}

/** A docked side column on a tablet (the agent): the same contents a phone gets in a sheet. */
function DockedPanel({ side, label, children }: { side: "left" | "right"; label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      className={`shrink-0 flex flex-col min-h-0 bg-panel ${
        side === "left" ? "w-72 border-r" : "w-84 border-l"
      } border-line`}
    >
      {children}
    </aside>
  );
}

/** The height the try panel's pads are fitted to: two rows of scale pads. */
const TRY_PADS_ROOM = 240;

export function MobileShell({
  shape,
  projectStore,
  scheduler,
  recorder,
  editLog,
  versionStore,
  dispatch,
  liveNotes,
  preview,
  selectedTrack,
  isPlaying,
  started,
  hasApiKey,
  onSelectView,
  onOpenAgentSettings,
  onOpenSettings,
  onOpenShare,
  onOpenTiming,
}: ShellProps & { shape: DeviceShape }) {
  /**
   * The detent is **shell state, not the sheet's** (ARCH-3): the arrangement above the sheet
   * reads it too. The sheet is handed it and reports changes back.
   *
   * It opens at **Half**, and that follows from a property of the app rather than a taste:
   * there is always a track and a clip selected, so there is always something to edit and
   * showing it is not presuming. Opening parked was tried and reads as the editor having
   * failed to open - you land on a project, the thing you came to edit is a lip at the
   * bottom, and the tap that fixes that carries no information.
   *
   * **This flips if an empty selection ever becomes possible.** Nothing to edit means the
   * honest states are parked, or no sheet at all, and Half would then be the panel you did
   * not ask for. Keep the reasoning attached to the constraint, not to the number.
   */
  const [detent, setDetent] = useState<Detent>("half");
  // Which place is in front. Kept across reloads: you come back to where you were.
  const [tab, setTab] = usePersistentString<MobileTab>("corrente:mobile-tab", "studio", MOBILE_TABS);
  // "home" is the list of projects (MOBILE-19.3); "inside" is the open project's own views.
  const [projectsPage, setProjectsPage] = usePersistentString<ProjectsPage>(
    PROJECTS_PAGE_KEY,
    PROJECTS_PAGE_DEFAULT,
    PROJECTS_PAGES,
  );
  /**
   * Where each tab starts. Tapping the tab you are already on goes back there, as phone apps' tab
   * bars do; Projects also starts there whenever it is chosen, so it always opens on the project
   * you have open, with the list one step up (2026-10-13, Alden).
   */
  const tabStart: Partial<Record<MobileTab, () => void>> = {
    explore: () => openExplorePage("home"),
    projects: () => setProjectsPage("inside"),
  };
  const selectTab = (next: MobileTab) => {
    if (next === tab || next === "projects") tabStart[next]?.();
    setTab(next);
  };
  const [agentOpen, setAgentOpen] = useState(false);
  const project = useProject(projectStore);
  /*
   * Choosing a track no longer raises a parked sheet (2026-10-12, Alden): tapping lanes to look
   * around kept throwing the editor over the arrangement you were looking at. The sheet stays at
   * the detent you left it, and its minimised bar names the selected track, so a tap there opens it.
   */
  const { canUndo, canRedo } = useEditLog(editLog);

  /**
   * On a tablet the agent **docks** beside the workspace instead of sliding over it: there is
   * width for a column, and covering what you are editing to talk about it is a phone
   * compromise, not a virtue. The same ✦ toggles it either way.
   *
   * Not on a phone in landscape: it lands in the same tier at ~844px but is only ~390px
   * tall, and a docked column there would leave the workspace a sliver.
   */
  const docked = shape.tier === "tablet" && !shape.short;

  /**
   * The workspace's height, for the detents. The pads size themselves against the Studio as a
   * whole, the keys included (`studioRef`): a box that holds still as they grow, where the
   * workspace above them gives way.
   */
  const workspaceRef = useRef<HTMLDivElement>(null);
  const workspaceHeight = useElementHeight(workspaceRef);
  const studioRef = useRef<HTMLDivElement>(null);
  const studioHeight = useElementHeight(studioRef);
  // Minimised is the header and nothing else. The home indicator's inset is the tab bar's to
  // carry now, below the workspace.
  const detents = detentsFor(shape, { workspaceHeight, peekPixels: SHEET_HEADER_HEIGHT });
  const revealSamples = () => {
    openExplorePage("samples");
    onSelectView("explore");
    setTab("explore");
  };

  /**
   * The "+" in the top bar: what the arrangement's own "+" offers on desktop - a group, a MIDI or
   * audio track in a group of your choosing (MOBILE-19.4). The surfaces used to carry a tools menu
   * each, beside the arrangement and in the sheet header; their settings moved to the settings
   * panel, zoom is the pinch gesture, and Quantize lives on a selected note, which left adding
   * things as the one job, and the top bar the place with room for it.
   *
   */
  const addMenu = tab === "studio" && (
    <Menu
      items={arrangementAddItems(project.groups, dispatch)}
      label="Add to the arrangement"
      align="left"
      triggerClassName={iconButtonClass({ size: "lg", className: "shrink-0" })}
      trigger={
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="w-5 h-5"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
      }
    />
  );

  const agent = (
    <AgentPanel
      // Back to the library list: there is no separate panel to close any more.
      onCollapse={() => setAgentOpen(false)}
      projectStore={projectStore}
      dispatch={dispatch}
      scheduler={scheduler}
      hasApiKey={hasApiKey}
      onOpenAgentSettings={onOpenAgentSettings}
    />
  );

  /**
   * A browsing tab: its views across the top and the library panel under them. Taking something
   * out of it (an instrument, a device, a sample) goes to the Studio, because what it changed is
   * there and a full-screen tab in front of it would show nothing happening (MOBILE-9).
   */
  const browse = (browseTab: BrowseTab, view: LibraryView, onView: (view: LibraryView) => void) => (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-panel">
      <ViewRail tab={browseTab} current={view} onSelect={onView} />
      <LibraryPanel
        projectStore={projectStore}
        editLog={editLog}
        versionStore={versionStore}
        dispatch={dispatch}
        activeView={view}
        onOpenShare={onOpenShare}
        onPick={() => setTab("studio")}
        onOpenTiming={onOpenTiming}
        preview={preview}
        recorder={recorder}
        // No computer keyboard on a phone: the try panel gets the pads (COMM-1.4.1).
        tryPads={(track) => (
          <NotePads
            track={track}
            samples={project.samples}
            notes={liveNotes}
            octavesPerRow={shape.tier === "tablet" ? 2 : 1}
            room={TRY_PADS_ROOM}
          />
        )}
      />
    </div>
  );

  return (
    <div
      className="flex-1 min-h-0 flex flex-col relative overflow-hidden"
      // Section headers at a finger's height, all the way down (MOBILE-24).
      style={{ ["--section-header" as string]: `${TOUCH_SECTION_HEADER_HEIGHT}px` }}
      data-device-tier={shape.tier}
      data-viewport-short={shape.short || undefined}
    >
      {/* The insets are padding, not margin, so `bg-rail` still runs up behind the status bar
          and the notch reads as part of the app rather than as a letterbox. */}
      <div
        className="shrink-0 flex items-center gap-2 py-1.5 border-b border-line bg-rail"
        style={{
          paddingTop: atLeast("0.375rem", SAFE_TOP),
          paddingLeft: atLeast("0.5rem", SAFE_LEFT),
          paddingRight: atLeast("0.5rem", SAFE_RIGHT),
        }}
      >
        <div className="shrink-0">
          <TransportBar
            projectStore={projectStore}
            scheduler={scheduler}
            recorder={recorder}
            dispatch={dispatch}
            isPlaying={isPlaying}
            started={started}
            compact
          />
        </div>
        {/* Undo / redo earn permanent slots on touch: there is no keyboard shortcut to
            fall back on, and fearless iteration is the point of the authored edit log. Beside
            the transport, so the left of the bar is "doing" and the right is "you". */}
        <BarButton label="Undo" onClick={() => editLog.undo()} disabled={!canUndo}>
          <UndoIcon />
        </BarButton>
        <BarButton label="Redo" onClick={() => editLog.redo()} disabled={!canRedo}>
          <UndoIcon flip />
        </BarButton>
        {addMenu}
        <div className="flex-1" />
        <BarButton label="Agent" tint="agent" onClick={() => setAgentOpen(!agentOpen)} active={agentOpen}>
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="w-5 h-5">
            <path d="M8 1.75l1.6 4.15 4.15 1.6-4.15 1.6L8 13.25l-1.6-4.15L2.25 7.5l4.15-1.6z" />
          </svg>
        </BarButton>
        {/* You, as your initials: the way into account and settings. */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Account and settings"
          title="Account and settings"
          className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full cursor-pointer focus-visible:outline-2 focus-visible:outline-you"
        >
          <AccountAvatar size={30} />
        </button>
      </div>

      {/* The middle band: whichever tab is in front, with the agent docked beside it on a
          tablet. On a phone the agent is a sheet over it (rendered below). */}
      <div className="flex-1 min-h-0 flex">
        {tab === "projects" &&
          (projectsPage === "home" ? (
            <ProjectsHome
              projectStore={projectStore}
              editLog={editLog}
              versionStore={versionStore}
              onOpenProject={() => setProjectsPage("inside")}
              onOpenShare={onOpenShare}
            />
          ) : (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-panel">
              <BackToProjects onBack={() => setProjectsPage("home")} />
              <ProjectOverview
                projectStore={projectStore}
                editLog={editLog}
                dispatch={dispatch}
                history={<ActivityView editLog={editLog} versionStore={versionStore} />}
                onOpenShare={onOpenShare}
                onOpenTiming={onOpenTiming}
                // A track chosen here is for editing, and the editor is in the Studio.
                onOpenTrack={() => setTab("studio")}
              />
            </div>
          ))}
        {tab === "explore" && browse("explore", "explore", onSelectView)}
        {/* The Studio. Hidden rather than unmounted behind the other tabs, so the arrangement's
            scroll, the editor and an in-progress recording all survive a trip to Explore. */}
        <div ref={studioRef} hidden={tab !== "studio"} className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* `relative` because the sheet is absolutely positioned against this column, not the
              shell: on a tablet it must not run under the docked agent, which owns its height. */}
          <div
            ref={workspaceRef}
            className="relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
            // For the arrangement, which is an ordinary flex child. The editor sheet is
            // absolutely positioned against this box and so is *not* inset by this padding -
            // it carries its own. See `safeArea.ts`.
            style={{ paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT }}
          >
            <div
              className="min-h-0 flex flex-col"
              // The band above the sheet, so the timeline's own horizontal scroller stays on
              // screen instead of sitting under it. Committed detents only - during a drag
              // the sheet slides over this rather than resizing it every frame.
              style={{ height: selectedTrack ? `${(1 - detents[detent]) * 100}%` : "100%" }}
            >
              <ArrangementTimeline
                projectStore={projectStore}
                scheduler={scheduler}
                recorder={recorder}
                dispatch={dispatch}
                isPlaying={isPlaying}
                started={started}
                // One transport is pinned above the workspace, so the timeline must not render
                // a second copy, and its own options move into the shell's ⋮.
                showTransport={false}
                compact
              />
            </div>
            {/* No sheet without a track: there is nothing to edit, and an empty sheet over
                the arrangement would just be a lid. Selecting a track brings it back at
                whatever detent it was left at. */}
            {selectedTrack && (
              <EditorSheet
                detent={detent}
                detents={detents}
                onDetentChange={setDetent}
                title={selectedTrack.name}
                subtitle={selectedTrack.kind === "audio" ? "audio" : selectedTrack.instrumentType}
                preview={sheetPreview(selectedTrack, beatsPerBarOf(project.timeSignature))}
              >
                <WorkbenchColumn
                  key={selectedTrack.id}
                  track={selectedTrack}
                  projectStore={projectStore}
                  scheduler={scheduler}
                  recorder={recorder}
                  dispatch={dispatch}
                  onRevealSamples={revealSamples}
                  compact
                />
              </EditorSheet>
            )}
          </div>
          {/* The keys dock under the Studio as a phone's keyboard does, pushing it up rather than
              covering it: they play whatever the sheet is showing, and at any detent. */}
          {selectedTrack?.kind === "instrument" && (
            <section
              aria-label="Keys"
              data-testid="keys-dock"
              className="shrink-0 bg-panel border-t border-line"
              style={{ paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT }}
            >
              <NotePads
                track={selectedTrack}
                samples={project.samples}
                notes={liveNotes}
                // A tablet has the width for two octaves in a row; a phone does not, and
                // below ~44px per pad the layout is wrong rather than merely tight.
                octavesPerRow={shape.tier === "tablet" ? 2 : 1}
                room={studioHeight}
              />
            </section>
          )}
        </div>
        {docked && agentOpen && (
          <DockedPanel side="right" label="Agent">
            {agent}
          </DockedPanel>
        )}
      </div>

      <TabBar tab={tab} onSelect={selectTab} />

      {!docked && (
        <Sheet
          open={agentOpen}
          side="right"
          label="Agent"
          onClose={() => setAgentOpen(false)}
          widthClass="w-[92%] max-w-120"
        >
          {agent}
        </Sheet>
      )}
    </div>
  );
}
