/**
 * The center workbench: everything about the selected track in one scrolling column
 * (DAW-61.1), reading top to bottom as the signal path - the clips as a line, the notes (or
 * the audio clip) under them, then the devices, wrapping as blocks. The roll scrolls away to
 * give the devices the room; a slim bar then brings it back, or jumps to any device.
 *
 * The wheel needs no rule of its own: the roll takes it while the pointer is over it, and
 * the browser keeps a scroll that is already moving the column going past the roll.
 *
 * This is the *desktop* composition of three pieces that the touch shell splits across
 * tabs instead (MOBILE-1): the clip rail, the editor (`workbench/TrackEditor`) and the
 * device chain (`workbench/DeviceRack`). Only the arrangement lives here; each piece
 * owns its own behaviour.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectStore, Track } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Recorder } from "../audio/recording/recorder";
import type { Dispatch } from "../audio/commands/types";
import type { McpStatus } from "../audio/mcp/bridge";
import type { WsStatus } from "../contract/client";
import { SyncChip } from "./ConnectionStatus";
import { useProject } from "../audio/project/useProject";
import { useRecorder } from "./useRecorder";
import { EMPTY_INSTRUMENT } from "../audio/instruments/catalog";
import { ClipRail } from "./ClipRail";
import { InlineRename } from "./InlineRename";
import { ResizeHandle } from "./ResizeHandle";
import { usePersistentBoolean, usePersistentNumber } from "./usePersistent";
import { TrackEditor } from "./workbench/TrackEditor";
import { DeviceRack } from "./workbench/DeviceRack";
import { TrackRecordButton } from "./workbench/TrackRecordButton";
import { ReturnBar } from "./workbench/ReturnBar";

/** The clips line's height, which the roll leaves room for so the two always fit together. */
const CLIPS_LINE = 48;
/** What of the devices always shows under the roll, so it's plain there is more below. */
const DEVICES_PEEK = 56;
/**
 * How little of the roll is left on screen when the return bar shows: once it's mostly off the top,
 * not the moment its first row leaves.
 */
const ROLL_LEFT = 0.25;

// The built-in agent does not need MCP, so a missing connection is not a warning:
// only "connected" is called out (green + label); otherwise it is a quiet grey dot
// you can hover for status.
const MCP_DOT: Record<McpStatus, string> = {
  connected: "bg-good",
  connecting: "bg-faint",
  disconnected: "bg-faint",
};
const MCP_TITLE: Record<McpStatus, string> = {
  connected: "MCP connected",
  connecting: "MCP connecting…",
  disconnected: "MCP disconnected",
};

export function CenterWorkbench({
  projectStore,
  scheduler,
  recorder,
  dispatch,
  selectedTrack,
  onRevealSamples,
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
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const recording = rec.status === "recording" || rec.status === "counting";
  // The roll's height is yours to drag, but never more than the column shows with the clips line
  // above it and the devices' heading below: a height saved on a big window would otherwise leave a
  // roll you can't see all of. It is the grid's height; the keys add theirs rather than eat into it.
  const [rollH, setRollH] = usePersistentNumber("corrente:roll-height", 380, 200, 1200);
  const [clipsOpen, setClipsOpen] = usePersistentBoolean("corrente:clips-open", false);
  const columnRef = useRef<HTMLDivElement>(null);
  const rollRef = useRef<HTMLDivElement>(null);
  const [columnH, setColumnH] = useState(0);
  const [rollGone, setRollGone] = useState(false);
  const trackId = selectedTrack?.id;
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const measure = () => setColumnH(column.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [trackId]);
  useEffect(() => {
    const column = columnRef.current;
    const roll = rollRef.current;
    if (!column || !roll) return;
    setRollGone(false);
    const observer = new IntersectionObserver(
      // Gone means scrolled off the top: a roll below the fold (a short window) isn't "gone".
      ([entry]) =>
        setRollGone(entry.intersectionRatio < ROLL_LEFT && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)),
      { root: column, threshold: [0, ROLL_LEFT, 1] },
    );
    observer.observe(roll);
    return () => observer.disconnect();
  }, [trackId]);
  const keysH = keys?.height ?? 0;
  const effRollH = columnH ? Math.min(rollH, Math.max(200, columnH - CLIPS_LINE - keysH - DEVICES_PEEK)) : rollH;
  const scrollToRoll = () => columnRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const scrollToDevice = (key: string) =>
    columnRef.current
      ?.querySelector(`[data-device="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });

  // The tab bar's right-hand indicator area: the MCP status dot, then (when the
  // agent pane is collapsed away) its expand control - there is no idle rail.
  const indicators = (
    <div className="ml-auto self-center flex items-center gap-2 pr-2">
      {syncStatus && <SyncChip status={syncStatus} />}
      {/* MCP is a dev/local bridge; show it only when actually connected, so it doesn't sit as a
          second bare dot beside the sync chip (confusing) the rest of the time. */}
      {mcpStatus === "connected" && (
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

      <div ref={columnRef} className="relative flex-1 min-h-0 min-w-0 overflow-y-auto" key={`${selectedTrack.id}:body`}>
        {/* Sticky but no height of its own, so showing it never shifts the column under you. */}
        <div className="sticky top-0 z-20 h-0">
          {rollGone && <ReturnBar track={selectedTrack} onRoll={scrollToRoll} onDevice={scrollToDevice} />}
        </div>

        {/* Clips: one line that scrolls sideways, or open, every clip as a bigger chip. */}
        <section
          aria-label="Clips"
          className={`flex gap-1 px-1.5 border-b border-line ${clipsOpen ? "items-start py-1.5" : "items-center"}`}
          style={{ minHeight: CLIPS_LINE }}
        >
          <button
            type="button"
            aria-expanded={clipsOpen}
            aria-label={clipsOpen ? "Fold the clips" : "Open the clips"}
            onClick={() => setClipsOpen(!clipsOpen)}
            className="flex items-center justify-center w-7 h-9 shrink-0 text-[16px] leading-none text-muted hover:text-ink cursor-pointer"
          >
            <span aria-hidden="true" className={clipsOpen ? "rotate-90" : ""}>
              ▸
            </span>
          </button>
          <div className="flex-1 min-w-0">
            <ClipRail
              projectStore={projectStore}
              scheduler={scheduler}
              trackId={selectedTrack.id}
              dispatch={dispatch}
              orientation={clipsOpen ? "grid" : "horizontal"}
              footer={
                // At the line's end, at its own size: the button fills whatever holds it.
                <div className="ml-auto shrink-0 w-20">
                  <TrackRecordButton trackId={selectedTrack.id} recorder={recorder} recording={recording} />
                </div>
              }
            />
          </div>
        </section>

        {/* The roll (or the audio clip), at a height dragged from its bottom edge. */}
        <div ref={rollRef} className="relative flex flex-col" style={{ height: effRollH + keysH }}>
          <TrackEditor
            track={selectedTrack}
            scheduler={scheduler}
            recorder={recorder}
            dispatch={dispatch}
            projectStore={projectStore}
            // The keys sit in the roll under the velocity lane, as the pads sit under the roll on
            // mobile (MOBILE-6): play, and watch it land.
            rollFooter={keys && <div style={{ height: keys.height }}>{keys.panel}</div>}
          />
          <ResizeHandle
            ariaLabel="Resize the roll"
            orientation="horizontal"
            onResize={(y) => setRollH(y - (rollRef.current?.getBoundingClientRect().top ?? 0) - keysH)}
            style={{ left: 0, right: 0, bottom: 0 }}
          />
        </div>

        {/* The devices, as many rows as they need: the column scrolls, not the rack. */}
        <div className="px-3 pt-3 pb-6">
          <div className="flex flex-col rounded-lg border border-line bg-stage">
            <DeviceRack
              track={selectedTrack}
              samples={project.samples}
              dispatch={dispatch}
              projectStore={projectStore}
              onRevealSamples={onRevealSamples}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
