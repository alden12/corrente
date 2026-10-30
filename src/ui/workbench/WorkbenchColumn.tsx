/**
 * Everything about the selected track in one scrolling column (DAW-61.1), reading top to bottom
 * as the signal path - the clips as a line, the notes (or the audio clip) under them, then the
 * devices, wrapping as blocks. The roll scrolls away to give the devices the room; their bar,
 * sticky at the top, then brings it back or jumps to any device.
 *
 * Both shells host it (MOBILE-24): the desktop under its editor tab, the phone in the editor sheet,
 * where it replaced a switch between the roll, the clips and the rack. Only the keys differ: the
 * desktop's sit in the roll, the phone's pads dock outside the sheet.
 *
 * The wheel needs no rule of its own: the roll takes it while the pointer is over it, and
 * the browser keeps a scroll that is already moving the column going past the roll.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Recorder } from "../../audio/recording/recorder";
import type { Dispatch } from "../../audio/commands/types";
import { useProject } from "../../audio/project/useProject";
import { useRecorder } from "../useRecorder";
import { ClipRail } from "../ClipRail";
import { ResizeHandle } from "../ResizeHandle";
import { usePersistentBoolean, usePersistentNumber } from "../usePersistent";
import { TrackEditor } from "./TrackEditor";
import { DeviceRack } from "./DeviceRack";
import { RackStacked } from "../devices/rackLayout";
import { TrackRecordButton } from "./TrackRecordButton";
import { DevicesBar } from "./DevicesBar";
import { SectionHeader, SECTION_HEADER_HEIGHT, TOUCH_SECTION_HEADER_HEIGHT } from "../controls/SectionHeader";
import { IconButton } from "../controls/IconButton";
import { newClipId } from "../../audio/commands/ids";
import { BinIcon } from "../shellIcons";

/** What of the devices always shows under the roll (their bar), so it's plain there is more below. */
const DEVICES_PEEK = 56;

export function WorkbenchColumn({
  track,
  projectStore,
  scheduler,
  recorder,
  dispatch,
  onRevealSamples,
  keys,
  compact = false,
}: {
  track: Track;
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  dispatch: Dispatch;
  /** Reveal the Samples library view (threaded to an empty Sampler's picker). */
  onRevealSamples?: () => void;
  /** The computer-keyboard panel (DAW-12.1), shown in the piano roll under its velocity lane. */
  keys?: { panel: ReactNode; height: number; open: boolean };
  /** Touch: the roll's header keeps its fold and drops its tools (MOBILE-1). */
  compact?: boolean;
}) {
  const project = useProject(projectStore);
  const rec = useRecorder(recorder);
  const recording = rec.status === "recording" || rec.status === "counting";
  // The roll's height is yours to drag, but never more than the column shows with the clips line
  // above it and the devices' heading below: a height saved on a big window would otherwise leave a
  // roll you can't see all of. It is the grid's height; the keys add theirs rather than eat into it.
  const [rollH, setRollH] = usePersistentNumber("corrente:roll-height", 300, 200, 1200);
  const [clipsOpen, setClipsOpen] = usePersistentBoolean("corrente:clips-open", false);
  const [devicesOpen, setDevicesOpen] = usePersistentBoolean("corrente:devices-open", true);
  const [rollOpen, setRollOpen] = usePersistentBoolean("corrente:roll-open", true);
  // Deleting clips is a mode of the open clips, not a button on every chip: a chip's × was small
  // enough to hit by accident while picking a clip. Folding the clips ends it.
  const [deletingClips, setDeletingClips] = useState(false);
  const columnRef = useRef<HTMLDivElement>(null);
  const rollRef = useRef<HTMLDivElement>(null);
  const [columnH, setColumnH] = useState(0);
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const measure = () => setColumnH(column.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, []);
  const keysH = keys?.height ?? 0;
  // The clips line (its header), which the roll leaves room for so the two always fit together.
  const clipsLine = compact ? TOUCH_SECTION_HEADER_HEIGHT : SECTION_HEADER_HEIGHT;
  const roomForRoll = columnH - clipsLine - keysH - DEVICES_PEEK;
  // On touch the roll is not dragged: it takes all the sheet gives it, raising the sheet is how you
  // make it taller, and the column scrolls on to the devices. Never under a readable floor.
  const effRollH = !columnH
    ? rollH
    : compact
      ? Math.max(120, roomForRoll)
      : Math.min(rollH, Math.max(200, roomForRoll));
  const scrollToDevice = (key: string) => {
    const scroll = () =>
      columnRef.current
        ?.querySelector(`[data-device="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (devicesOpen) return scroll();
    // Folded away: open them, and scroll once they have drawn.
    setDevicesOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(scroll));
  };

  return (
    // `isolate`: the roll's sticky layers stack within the column, and never over the library's
    // resize handle, which straddles the column's left edge.
    <div
      ref={columnRef}
      data-testid="workbench-column"
      className="relative isolate flex-1 min-h-0 min-w-0 overflow-y-auto"
    >
      {/* Clips: folded, the chips scroll in the header; open, every clip as a chip below it. The
          + and record stay at the header's right either way. */}
      <section aria-label="Clips">
        <SectionHeader
          title="Clips"
          fold={{
            open: clipsOpen,
            onToggle: () => {
              setClipsOpen(!clipsOpen);
              setDeletingClips(false);
            },
          }}
          actions={
            <>
              {clipsOpen && (
                <IconButton
                  label={deletingClips ? "Done deleting clips" : "Delete clips"}
                  size={compact ? "md" : "sm"}
                  tone="hot"
                  active={deletingClips}
                  onClick={() => setDeletingClips(!deletingClips)}
                >
                  <BinIcon />
                </IconButton>
              )}
              {track.kind === "instrument" && (
                <IconButton
                  label="Add a new empty clip"
                  size={compact ? "md" : "sm"}
                  onClick={() => dispatch({ type: "addClip", trackId: track.id, id: newClipId(), empty: true })}
                >
                  +
                </IconButton>
              )}
              <TrackRecordButton trackId={track.id} recorder={recorder} recording={recording} round />
            </>
          }
        >
          {!clipsOpen && (
            <ClipRail
              projectStore={projectStore}
              scheduler={scheduler}
              trackId={track.id}
              dispatch={dispatch}
              orientation="horizontal"
              chipsOnly
            />
          )}
        </SectionHeader>
        {clipsOpen && (
          <div className="border-b border-line bg-ground">
            <ClipRail
              projectStore={projectStore}
              scheduler={scheduler}
              trackId={track.id}
              dispatch={dispatch}
              orientation="grid"
              dense
              chipsOnly
              deleting={deletingClips}
            />
          </div>
        )}
      </section>

      {/* The roll (or the audio clip), at a height dragged from its bottom edge. */}
      {/* Folded, it is its toolbar and the keys, at their own height. */}
      <div
        ref={rollRef}
        // A rule under whatever is last, unless that's a folded header, whose own rule is the divider (a
        // second would double it): the keys when the track has them, else the roll.
        className={`relative flex flex-col ${(keys && track.kind === "instrument" ? keys.open : rollOpen) ? "border-b border-line" : ""}`}
        style={rollOpen ? { height: effRollH + keysH } : undefined}
      >
        <TrackEditor
          track={track}
          scheduler={scheduler}
          recorder={recorder}
          dispatch={dispatch}
          projectStore={projectStore}
          compact={compact}
          // The keys sit in the roll under the velocity lane, as the pads sit under the roll on
          // mobile (MOBILE-6): play, and watch it land.
          rollFooter={keys && <div style={{ height: keys.height }}>{keys.panel}</div>}
          fold={{ open: rollOpen, onToggle: () => setRollOpen(!rollOpen) }}
        />
        {rollOpen && !compact && (
          <>
            <ResizeHandle
              ariaLabel="Resize the roll"
              orientation="horizontal"
              onResize={(y) => setRollH(y - (rollRef.current?.getBoundingClientRect().top ?? 0) - keysH)}
              style={{ left: 0, right: 0, bottom: 0 }}
            />
            {/* The keys' top edge is the roll's bottom too, and the more natural one to grab. */}
            {keysH > 0 && (
              <ResizeHandle
                ariaLabel="Resize the roll from the keys"
                orientation="horizontal"
                onResize={(y) => setRollH(y - (rollRef.current?.getBoundingClientRect().top ?? 0))}
                style={{ left: 0, right: 0, bottom: keysH }}
              />
            )}
          </>
        )}
      </div>

      {/* The devices, as many rows as they need: the column scrolls, not the rack. Their bar
          sticks to the top once they reach it. */}
      <section aria-label="Devices" className="pb-6">
        <DevicesBar
          track={track}
          projectStore={projectStore}
          open={devicesOpen}
          onToggle={() => setDevicesOpen(!devicesOpen)}
          onDevice={scrollToDevice}
        />
        {devicesOpen && (
          // On touch the column is a phone's width: the devices stack, everything flowing down it.
          <RackStacked.Provider value={compact}>
            <DeviceRack
              track={track}
              samples={project.samples}
              dispatch={dispatch}
              projectStore={projectStore}
              onRevealSamples={onRevealSamples}
              bare
            />
          </RackStacked.Provider>
        )}
      </section>
    </div>
  );
}
