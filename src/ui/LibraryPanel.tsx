/**
 * The library panel (beside the activity rail): shows exactly one view at a time - the view chosen
 * on the rail. The title bar, with undo and redo, is `LibraryHeader`. Explore, Project and
 * Activity delegate to their own components; Explore reads the same catalogs the engine and MCP
 * use, and holds the one search box (COMM-1.9.3), which finds your tracks as well as devices.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import type { Dispatch } from "../audio/commands/types";
import type { InstrumentTrack } from "../audio/project/projectStore";
import type { SoundPreview } from "../audio/live/preview";
import type { Recorder } from "../audio/recording/recorder";
import { TryPanel } from "./explore/TryPanel";
import { DevicePanel } from "./explore/DevicePanel";
import { SamplePanel } from "./explore/SamplePanel";
import { panelFor } from "./explore/exploreActions";
import type { ExploreItem } from "./explore/exploreItems";
import type { LibraryView } from "./ActivityRail";
import { ActivityView } from "./ActivityView";
import { LibraryHeader } from "./LibraryHeader";
import { ExploreView } from "./explore/ExploreView";
import { ProjectsHome } from "./projects/ProjectsHome";
import { ProjectsPlace } from "./projects/ProjectsPlace";
import { ProjectOverview } from "./projects/ProjectOverview";

export function LibraryPanel({
  projectStore,
  editLog,
  versionStore,
  dispatch,
  activeView,
  onOpenShare,
  onPick,
  onOpenTiming,
  preview,
  recorder,
  tryPads,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
  dispatch: Dispatch;
  activeView: LibraryView;
  onOpenShare: (projectId: string, projectName: string) => void;
  /** Something was taken from the library. Set where the panel is covering what it changes. */
  onPick?: () => void;
  /** The project's tempo / meter chips: open the Timing settings. */
  onOpenTiming: () => void;
  /** The sound being tried from Explore, shown in the try panel under it (COMM-1.4.1). */
  preview: SoundPreview;
  recorder: Recorder;
  /** What plays it where there is no computer keyboard: the phone's pads. */
  tryPads?: (track: InstrumentTrack) => ReactNode;
}) {
  // Trying belongs to Explore: leaving it (another view, or the panel going away) stops trying, so
  // the keys go back to playing the selected track.
  useEffect(() => {
    if (activeView !== "explore") preview.close();
    return () => preview.close();
  }, [activeView, preview]);

  // A device or sample tapped in Explore waits in its own panel (`panelFor`). One panel at a time:
  // trying a sound takes its place (and showing one of these closes the sound, in `itemTaps`).
  const [shown, setShown] = useState<ExploreItem | null>(null);
  useEffect(
    () =>
      preview.subscribe(() => {
        if (preview.getState()) setShown(null);
      }),
    [preview],
  );

  /**
   * Picking something out of the library: do it, then get out of the way.
   *
   * `onPick` is the phone's half: the library covers the whole screen there, so swapping an
   * instrument or adding a device changes something you cannot see, and the tab has to change for
   * anything to have visibly happened. Library *management* - deleting a patch, removing a sample,
   * hearting a device - is not a pick and stays put.
   */
  const picked = (act: () => void) => {
    act();
    onPick?.();
  };

  // One renderer per view (data-driven, so adding a view is a single entry).
  const views: Record<LibraryView, () => ReactNode> = {
    // The Projects home, and the open project one level in (MOBILE-19.3). The phone shows the same
    // two pages on its Projects tab, outside this panel.
    project: () => (
      <ProjectsPlace
        home={(openProject) => (
          <ProjectsHome
            projectStore={projectStore}
            editLog={editLog}
            versionStore={versionStore}
            onOpenProject={openProject}
            onOpenShare={onOpenShare}
            showTitle={false}
            canImport
          />
        )}
        inside={
          <ProjectOverview
            projectStore={projectStore}
            editLog={editLog}
            dispatch={dispatch}
            onOpenShare={onOpenShare}
            onOpenTiming={onOpenTiming}
          />
        }
      />
    ),
    activity: () => <ActivityView editLog={editLog} versionStore={versionStore} />,
    explore: () => (
      <ExploreView
        projectStore={projectStore}
        dispatch={dispatch}
        onPicked={picked}
        preview={preview}
        shown={shown?.key}
        onShow={setShown}
      />
    ),
  };

  return (
    <div className="[grid-area:library] min-w-0 bg-rail border-r border-line flex flex-col flex-1 min-h-0">
      <LibraryHeader activeView={activeView} editLog={editLog} />
      <div className="flex-1 min-h-0 overflow-y-auto">{views[activeView]()}</div>
      {activeView === "explore" && shown && panelFor(shown) === "add" && (
        <DevicePanel
          item={shown}
          projectStore={projectStore}
          dispatch={dispatch}
          onPicked={picked}
          onClose={() => setShown(null)}
          layout={tryPads ? "phone" : "desktop"}
        />
      )}
      {activeView === "explore" && shown && panelFor(shown) === "sample" && (
        <SamplePanel
          item={shown}
          projectStore={projectStore}
          dispatch={dispatch}
          preview={preview}
          onPicked={picked}
          onClose={() => setShown(null)}
          layout={tryPads ? "phone" : "desktop"}
        />
      )}
      {activeView === "explore" && (
        <TryPanel
          preview={preview}
          recorder={recorder}
          projectStore={projectStore}
          dispatch={dispatch}
          onPicked={picked}
          pads={tryPads}
        />
      )}
    </div>
  );
}
