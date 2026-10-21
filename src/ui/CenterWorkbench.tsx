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
import type { McpStatus } from "../audio/mcp/bridge";
import type { WsStatus } from "../contract/client";
import { SyncChip } from "./ConnectionStatus";
import { EMPTY_INSTRUMENT } from "../audio/instruments/catalog";
import { InlineRename } from "./InlineRename";
import { WorkbenchColumn } from "./workbench/WorkbenchColumn";
import { OnThisDeviceChip, onThisDevice, type Reminder } from "./hosting/OnThisDevice";

// The built-in agent does not need MCP, so a missing connection is not a warning:
// only "connected" is called out (green + label); otherwise it is a quiet grey dot
// you can hover for status.
const MCP_DOT: Record<McpStatus, string> = {
  connected: "bg-good",
  connecting: "bg-faint",
  standby: "bg-faint",
  disconnected: "bg-faint",
};
const MCP_TITLE: Record<McpStatus, string> = {
  connected: "MCP connected",
  connecting: "MCP connecting…",
  standby: "MCP connected, but driving another tab: the one most recently in front",
  disconnected: "MCP disconnected",
};

export function CenterWorkbench({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  selectedTrack,
  onRevealSamples,
  onRevealProject,
  backupReminder,
  mcpStatus,
  syncStatus,
  agentCollapsed,
  onExpandAgent,
  keys,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  selectedTrack: Track | undefined;
  /** Reveal the Samples library view (threaded to an empty Sampler's picker). */
  onRevealSamples?: () => void;
  /** Open the open project's own page (its Export button), from the "Saved in browser" chip. */
  onRevealProject?: () => void;
  /** The open project's log and export, for the chip's backup reminder. */
  backupReminder?: Reminder;
  /** MCP connection status - shown as a dot in the tab bar's indicator area. */
  mcpStatus: McpStatus;
  /** Sync-server connection status - shown as a chip beside MCP. `null` in local (no-sync) mode. */
  syncStatus: WsStatus | null;
  /** The agent pane is collapsed away; the tab bar hosts its expand control. */
  agentCollapsed: boolean;
  onExpandAgent: () => void;
  /** The computer-keyboard panel (DAW-12.1), shown in the piano roll under its velocity lane. */
  keys?: { panel: ReactNode; height: number };
}) {
  // The tab bar's right-hand indicator area: the MCP status dot, then (when the
  // agent pane is collapsed away) its expand control - there is no idle rail.
  const indicators = (
    <div className="ml-auto self-center flex items-center gap-2 pr-2">
      {syncStatus && <SyncChip status={syncStatus} />}
      {onThisDevice && onRevealProject && (
        <OnThisDeviceChip onShowProject={onRevealProject} reminder={backupReminder} />
      )}
      {/* MCP is a dev/local bridge; show it only when actually connected, so it doesn't sit as a
          second bare dot beside the sync chip (confusing) the rest of the time. Grey when the agent
          drives another tab. */}
      {(mcpStatus === "connected" || mcpStatus === "standby") && (
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted"
          title={MCP_TITLE[mcpStatus]}
        >
          <span className={`w-2 h-2 rounded-full ${MCP_DOT[mcpStatus]}`} />
          MCP
        </span>
      )}
      {agentCollapsed && (
        <button
          type="button"
          onClick={onExpandAgent}
          aria-label="Expand agent panel"
          title="Open the agent panel"
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted hover:text-strong hover:bg-panel cursor-pointer"
        >
          <span className="text-lg leading-none">«</span>
        </button>
      )}
    </div>
  );

  if (!selectedTrack) {
    return (
      <div className="[grid-area:center] bg-ground flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className="flex items-center h-11 border-b border-line bg-frame shrink-0">{indicators}</div>
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
          multi-window tabs); it carries the track name + kind chip. The agent-expand
          control sits at the far right of the tab bar. */}
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
        {indicators}
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
