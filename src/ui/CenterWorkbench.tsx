/**
 * The center workbench: the editor tabs (DAW-89), and under them everything about the selected
 * track in one scrolling column (`workbench/WorkbenchColumn`, DAW-61.1), which the touch shell
 * hosts in its editor sheet too. The app's status indicators are at the foot of the activity rail
 * (DAW-87).
 */
import { Suspense, type ReactNode } from "react";
import type { ProjectStore, Track } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import { EditorTabBar } from "./tabs/EditorTabBar";
import { tabKey } from "./tabs/editorTabs";
import { useEditorTabs } from "./tabs/useEditorTabs";

import { WorkbenchColumn } from "./workbench/WorkbenchColumn";
import { ProjectEditors } from "./ProjectEditors";
import { graphDevices } from "./graph/graphDevices";
import { LazyDeviceGraphView } from "./graph/lazyGraphView";
import { PreviewBar } from "./preview/PreviewBar";
import { isPreviewTrackId } from "../audio/project/previewTrack";

export function CenterWorkbench({
  projectId,
  projectStore,
  scheduler,
  recorder,
  dispatch,
  selectedTrack,
  onRevealSamples,
  keys,
  onOpenEditorColors,
}: {
  /** The project the store holds: the tabs are kept per project. */
  projectId: string | null;
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  selectedTrack: Track | undefined;
  /** Reveal the Samples library view (threaded to an empty Sampler's picker). */
  onRevealSamples?: () => void;
  /** The computer-keyboard panel (DAW-12.1), shown in the piano roll under its velocity lane. */
  keys?: { panel: ReactNode; height: number; open: boolean };
  /** Settings, open where editors' colours are picked. */
  onOpenEditorColors: () => void;
}) {
  const tabs = useEditorTabs(projectId, projectStore, selectedTrack?.id ?? null);
  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-ground flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className="h-10 border-b border-line bg-frame shrink-0" />
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          No track selected. Add an instrument or import audio from the library.
        </div>
      </div>
    );
  }

  // The tab shown, if it's a graph rather than the selected track: its devices, in chain order.
  const shown = tabs.state.tabs.find((tab) => tabKey(tab.target) === tabs.state.active)?.target;
  const graph = shown && shown.kind !== "track" ? graphDevices(shown, projectStore) : undefined;

  // An edit made in a tab keeps it, as VS Code keeps a preview you type into.
  const editing: Dispatch = (command, author) => {
    tabs.keepShown();
    dispatch(command, author);
  };

  return (
    <div className="[grid-area:center] bg-ground flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
      <div className="flex items-stretch shrink-0 border-b border-line bg-frame">
        <EditorTabBar tabs={tabs} projectStore={projectStore} dispatch={dispatch} />
        <ProjectEditors projectStore={projectStore} onOpenColors={onOpenEditorColors} />
      </div>

      {graph ? (
        <Suspense
          fallback={<p className="flex-1 flex items-center justify-center text-sm text-muted">Drawing the graph…</p>}
        >
          <LazyDeviceGraphView key={tabKey(shown!)} devices={graph} />
        </Suspense>
      ) : (
        <WorkbenchColumn
          key={selectedTrack.id}
          track={selectedTrack}
          projectStore={projectStore}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={editing}
          onRevealSamples={onRevealSamples}
          keys={keys}
          // Your preview (COMM-1.4.5) is a track like any, with the row that takes it on top.
          preview={
            isPreviewTrackId(selectedTrack.id) && selectedTrack.kind === "instrument" ? (
              <PreviewBar preview={selectedTrack} projectStore={projectStore} dispatch={dispatch} layout="desktop" />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
