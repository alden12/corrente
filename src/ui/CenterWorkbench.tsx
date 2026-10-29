/**
 * The center workbench: the selected track's editor tab, and under it everything about the
 * track in one scrolling column (`workbench/WorkbenchColumn`, DAW-61.1), which the touch shell
 * hosts in its editor sheet too.
 */
import type { ReactNode } from "react";
import type { ProjectStore, Track } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import { EMPTY_INSTRUMENT } from "../audio/instruments/catalog";
import { InlineRename } from "./InlineRename";
import { WorkbenchColumn } from "./workbench/WorkbenchColumn";

export function CenterWorkbench({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  selectedTrack,
  onRevealSamples,
  keys,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  selectedTrack: Track | undefined;
  /** Reveal the Samples library view (threaded to an empty Sampler's picker). */
  onRevealSamples?: () => void;
  /** The computer-keyboard panel (DAW-12.1), shown in the piano roll under its velocity lane. */
  keys?: { panel: ReactNode; height: number };
}) {
  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-ground flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className="h-11 border-b border-line bg-frame shrink-0" />
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          No track selected. Add an instrument or import audio from the library.
        </div>
      </div>
    );
  }

  const kindLabel =
    selectedTrack.kind === "audio"
      ? "audio"
      : selectedTrack.instrumentType === EMPTY_INSTRUMENT
        ? "empty"
        : selectedTrack.instrumentType;

  return (
    <div className="[grid-area:center] bg-ground flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
      {/* The selected track is a single editor tab (reserving space for future
          multi-window tabs); it carries the track name + kind chip. The app's status
          indicators are at the foot of the activity rail (DAW-87). */}
      <div
        className="flex items-stretch h-11 border-b border-line bg-frame shrink-0"
        role="tablist"
        aria-label="Open editors"
      >
        {/* No fill on the active tab: the bar is its own surface (`frame`) and the teal underline
            is what marks selection. A lighter chip here was the one thing lifting off it. */}
        <div className="relative flex items-center gap-2 h-full pl-3.5 pr-4 border-r border-line max-w-72">
          <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-you" />
          <span className="w-2 h-2 rounded-full bg-you shrink-0" />
          <InlineRename
            value={selectedTrack.name}
            onCommit={(name) => dispatch({ type: "setTrack", trackId: selectedTrack.id, name })}
            className="font-semibold text-sm text-strong"
          />
          <span className="font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">{kindLabel}</span>
        </div>
      </div>

      <WorkbenchColumn
        key={selectedTrack.id}
        track={selectedTrack}
        projectStore={projectStore}
        scheduler={scheduler}
        recorder={recorder}
        dispatch={dispatch}
        onRevealSamples={onRevealSamples}
        keys={keys}
      />
    </div>
  );
}
