/**
 * A track's automation on the timeline (DAW-67.4), in rows above its own: each automation clip
 * where it plays, its curve drawn in it. Runs that don't overlap share a row; an overlap gets
 * another (`packRuns`). The canvas's "Timeline" and "Stacked" boards.
 *
 * - **A clip names its knob**: "Filter sweep · Cutoff", with "+1" for each more it drives, which
 *   opens the list. The row's header sums up the knobs its clips drive, with an eye to hide it.
 * - **Folded**, the track's chip shrinks every row into one thin band, every curve drawn faintly,
 *   so you can see automation is there without the rows taking room.
 * - **A linked clip** (one playing with a note clip) is dashed, with a chain, and goes where its
 *   note clip goes: it can be picked and unlinked but not dragged.
 * - **Drag** a placed clip to move it, its right edge to trim it; each drag is one undo step. A
 *   right-click (or its menu) links, unlinks, duplicates or removes it.
 *
 * Picking one makes it the automation clip the workbench shows (`automationSelection`).
 */
import { useRef } from "react";
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import type { AutomationClipData } from "../../audio/project/types";
import type { AutomationRun } from "../../audio/automation/playback";
import { packRuns, runCurve } from "../../audio/automation/rows";
import { AUTOMATION_ROW_PX, FOLDED_BAND_PX, timelineRuns } from "./automationLayout";
import { clipValueAt } from "../../audio/automation/curve";
import { newAutomationId, newPlacementId } from "../../audio/commands/ids";
import { paletteAccent } from "../deviceColor";
import { beginPointerDrag } from "../pointerDrag";
import { beatToX, floorBeat, snapBeat, xToBeat } from "../timeline/timeGrid";
import { GRID } from "../../audio/sequencer/types";
import { Menu, type MenuItem } from "../Menu";
import { useContextMenu } from "../useContextMenu";
import { automationSelection, newAutomationPoints, useAutomationSelection } from "../automation/automationSelection";
import { knobLabel } from "../automation/labels";
import { GUTTER_PAD, INDENT, RESIZE_PX } from "./shared";

/** The curve's inset from a block's top and bottom. */
const CURVE_INSET = 4;

/** The chain drawn on a linked clip. */
function ChainIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <path
        d="M5 7 L7 5 M4 5 L2.5 6.5 A2 2 0 0 0 5.5 9.5 L7 8 M8 7 L9.5 5.5 A2 2 0 0 0 6.5 2.5 L5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/** An eye, struck through when what it marks is hidden. */
export function EyeIcon({ shut = false }: { shut?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 8 C4 3.5 12 3.5 14.5 8 C12 12.5 4 12.5 1.5 8 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      {shut && <path d="M2 14 L14 2" stroke="currentColor" strokeWidth="1.3" />}
    </svg>
  );
}

export function AutomationRows({
  track,
  depth,
  folded,
  hidden,
  onHideRow,
  headerW,
  laneWidth,
  pxPerBeat,
  beatsPerBar,
  snapOn,
  snapDiv,
  stickyHeader,
  onPick,
  projectStore,
  dispatch,
}: {
  track: Track;
  depth: number;
  folded: boolean;
  /** The rows hidden by their eye. */
  hidden: ReadonlySet<number>;
  onHideRow: (row: number) => void;
  headerW: number;
  laneWidth: number;
  pxPerBeat: number;
  beatsPerBar: number;
  snapOn: boolean;
  snapDiv: number;
  stickyHeader: boolean;
  /** An automation clip was picked: the timeline drops its own clip selection. */
  onPick: () => void;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  const runs = timelineRuns(track);
  const { packed, rows } = packRuns(runs);
  const chosen = useAutomationSelection();
  const { openAt, menu } = useContextMenu();
  if (rows === 0) return null;

  const pick = (run: AutomationRun) => {
    onPick();
    projectStore.selectTrack(track.id);
    automationSelection.set({
      trackId: track.id,
      automationId: run.clip.id,
      ...(run.placementId ? { placementId: run.placementId } : {}),
    });
  };
  const isChosen = (run: AutomationRun) =>
    chosen?.trackId === track.id &&
    chosen.automationId === run.clip.id &&
    (chosen.placementId === undefined || chosen.placementId === run.placementId);

  const header = (content: React.ReactNode, height: number) => (
    <div className={`shrink-0 ${stickyHeader ? "sticky left-0 z-10" : ""}`} style={{ width: headerW }}>
      <div
        className="flex items-center gap-2 pr-1.5 border-b border-r border-line-soft bg-panel text-[11px] text-muted"
        style={{ height, paddingLeft: GUTTER_PAD + depth * INDENT + 18 }}
      >
        {content}
      </div>
    </div>
  );

  if (folded)
    return (
      <div className="flex" data-testid="automation-band" data-track-id={track.id}>
        {header(null, FOLDED_BAND_PX)}
        <div
          className="relative border-b border-line-soft bg-recess overflow-hidden"
          style={{ width: laneWidth, height: FOLDED_BAND_PX }}
        >
          {runs.map((run, index) => (
            <svg
              key={`${run.clip.id}:${index}`}
              aria-hidden="true"
              className="absolute top-0"
              style={{ left: beatToX(run.startBeat, pxPerBeat) }}
              width={beatToX(run.length, pxPerBeat)}
              height={FOLDED_BAND_PX}
            >
              <polyline
                points={runCurve(
                  (beat) => clipValueAt(run.clip, beat),
                  run,
                  beatToX(run.length, pxPerBeat),
                  FOLDED_BAND_PX,
                )}
                fill="none"
                stroke={paletteAccent(run.clip.color ?? track.color)}
                strokeOpacity={0.6}
                strokeWidth={1.2}
              />
            </svg>
          ))}
        </div>
      </div>
    );

  const visibleRows = Array.from({ length: rows }, (_, row) => row).filter((row) => !hidden.has(row));
  return (
    <>
      {visibleRows.map((row) => {
        const inRow = packed.filter((entry) => entry.row === row).map((entry) => entry.run);
        const knobs = [
          ...new Set(inRow.flatMap((run) => run.clip.bindings.map((binding) => knobLabel(track, binding).knob))),
        ];
        return (
          <div key={row} className="flex" data-testid="automation-row" data-track-id={track.id}>
            {header(
              <>
                <span className="flex-1 min-w-0 truncate" title={knobs.join(", ")}>
                  {knobs.length > 0 ? knobs.join(", ") : "Not driving anything yet"}
                </span>
                <button
                  type="button"
                  aria-label="Hide this automation row"
                  title="Hide this row"
                  onClick={() => onHideRow(row)}
                  className="w-7 h-7 shrink-0 grid place-items-center rounded text-muted hover:text-ink cursor-pointer"
                >
                  <EyeIcon />
                </button>
              </>,
              AUTOMATION_ROW_PX,
            )}
            <AutomationLane
              track={track}
              runs={inRow}
              width={laneWidth}
              pxPerBeat={pxPerBeat}
              beatsPerBar={beatsPerBar}
              snapOn={snapOn}
              snapDiv={snapDiv}
              isChosen={isChosen}
              onPick={pick}
              openMenu={openAt}
              dispatch={dispatch}
            />
          </div>
        );
      })}
      {menu}
    </>
  );
}

function AutomationLane({
  track,
  runs,
  width,
  pxPerBeat,
  beatsPerBar,
  snapOn,
  snapDiv,
  isChosen,
  onPick,
  openMenu,
  dispatch,
}: {
  track: Track;
  runs: AutomationRun[];
  width: number;
  pxPerBeat: number;
  beatsPerBar: number;
  snapOn: boolean;
  snapDiv: number;
  isChosen: (run: AutomationRun) => boolean;
  onPick: (run: AutomationRun) => void;
  openMenu: ReturnType<typeof useContextMenu>["openAt"];
  dispatch: Dispatch;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const beatAt = (clientX: number) => xToBeat(clientX - (ref.current?.getBoundingClientRect().left ?? 0), pxPerBeat);
  const snapB = (beat: number) => (snapOn ? snapBeat(beat, snapDiv) : beat);
  const minLength = snapOn ? snapDiv : GRID;

  /** Move a placed clip, or trim its end: one coalescing edit per drag. A linked clip only gets picked. */
  const beginDrag = (run: AutomationRun, gesture: "move" | "end", event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onPick(run);
    const placementId = run.placementId;
    if (!placementId) return;
    const downBeat = beatAt(event.clientX);
    beginPointerDrag((move) => {
      const delta = beatAt(move.clientX) - downBeat;
      if (gesture === "move") {
        const startBeat = Math.max(0, snapB(run.startBeat + delta));
        if (startBeat !== run.startBeat)
          dispatch({ type: "setAutomationPlacement", trackId: track.id, placementId, startBeat });
      } else {
        const length = Math.max(minLength, snapB(run.length + delta));
        if (length !== run.length) dispatch({ type: "setAutomationPlacement", trackId: track.id, placementId, length });
      }
    });
  };

  const noteClips = track.kind === "instrument" ? track.clips : [];
  const itemsFor = (run: AutomationRun): MenuItem[] => {
    const { clip } = run;
    const placementId = run.placementId;
    const link: MenuItem = {
      label: "Play with a clip",
      submenu: noteClips.map((noteClip) => ({
        label: noteClip.name,
        checked: clip.linkedClipId === noteClip.id,
        onClick: () =>
          dispatch({ type: "setAutomation", trackId: track.id, automationId: clip.id, linkedClipId: noteClip.id }),
      })),
    };
    const unlink: MenuItem = {
      // Placed where it played, so it goes on sounding there.
      label: "Unlink from its clip",
      onClick: () =>
        dispatch({
          type: "placeAutomation",
          trackId: track.id,
          id: newPlacementId(),
          automationId: clip.id,
          startBeat: run.startBeat,
          length: run.length,
        }),
    };
    const placed: MenuItem[] = placementId
      ? [
          {
            label: "Duplicate",
            onClick: () =>
              dispatch({
                type: "placeAutomation",
                trackId: track.id,
                id: newPlacementId(),
                automationId: clip.id,
                startBeat: run.startBeat + run.length,
                length: run.length,
                offset: run.offset,
              }),
          },
          {
            label: "Remove from the timeline",
            onClick: () => dispatch({ type: "removeAutomationPlacement", trackId: track.id, placementId }),
          },
        ]
      : [];
    return [
      ...(noteClips.length > 0 ? [link] : []),
      ...(clip.linkedClipId ? [unlink] : []),
      ...placed,
      { separator: true },
      {
        label: "Delete automation",
        danger: true,
        onClick: () => {
          dispatch({ type: "removeAutomation", trackId: track.id, automationId: clip.id });
          automationSelection.set(null);
        },
      },
    ];
  };

  /** Empty space: a new clip here, or the one picked on this track placed here again. */
  const laneItems = (beat: number): MenuItem[] => {
    const chosen = automationSelection.read();
    const again =
      chosen?.trackId === track.id ? track.automations.find((clip) => clip.id === chosen.automationId) : undefined;
    return [
      ...(again
        ? [
            {
              label: `Place ${again.name} here`,
              onClick: () =>
                dispatch({
                  type: "placeAutomation",
                  trackId: track.id,
                  id: newPlacementId(),
                  automationId: again.id,
                  startBeat: beat,
                }),
            },
          ]
        : []),
      {
        label: "New automation here",
        onClick: () => {
          const id = newAutomationId();
          dispatch({
            type: "addAutomation",
            trackId: track.id,
            id,
            points: newAutomationPoints(),
            placement: { id: newPlacementId(), startBeat: beat },
          });
          automationSelection.set({ trackId: track.id, automationId: id });
        },
      },
    ];
  };

  const laneBg = `repeating-linear-gradient(90deg, var(--color-line-soft) 0 1px, transparent 1px ${pxPerBeat * beatsPerBar}px)`;

  return (
    <div
      ref={ref}
      data-testid="automation-lane"
      onPointerDown={(event) => {
        if (event.button === 0) automationSelection.set(null);
      }}
      onContextMenu={(event) => {
        const beat = Math.max(0, floorBeat(beatAt(event.clientX), snapOn ? snapDiv : GRID));
        openMenu(event, () => laneItems(beat));
      }}
      className="relative border-b border-line-soft"
      style={{ width, height: AUTOMATION_ROW_PX, background: `${laneBg}, var(--color-recess)` }}
    >
      {runs.map((run, index) => (
        <AutomationBlock
          key={`${run.clip.id}:${run.placementId ?? index}`}
          track={track}
          run={run}
          pxPerBeat={pxPerBeat}
          chosen={isChosen(run)}
          onPointerDown={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const edge = event.pointerType === "mouse" && rect.right - event.clientX <= RESIZE_PX;
            beginDrag(run, edge ? "end" : "move", event);
          }}
          onContextMenu={(event) => {
            onPick(run);
            openMenu(event, itemsFor(run));
          }}
        />
      ))}
    </div>
  );
}

function AutomationBlock({
  track,
  run,
  pxPerBeat,
  chosen,
  onPointerDown,
  onContextMenu,
}: {
  track: Track;
  run: AutomationRun;
  pxPerBeat: number;
  chosen: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const { clip } = run;
  const accent = paletteAccent(clip.color ?? track.color);
  const width = Math.max(3, beatToX(run.length, pxPerBeat));
  const height = AUTOMATION_ROW_PX - 2 * CURVE_INSET;
  const labels = clip.bindings.map((binding) => knobLabel(track, binding));
  const linked = clip.linkedClipId !== undefined;
  return (
    <div
      data-testid="automation-clip"
      data-automation-id={clip.id}
      data-linked={linked}
      data-selected={chosen}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event);
      }}
      title={`${clip.name}${labels.length ? `: ${labels.map((label) => label.knob).join(", ")}` : ""}`}
      className={`absolute rounded border overflow-hidden touch-none ${linked ? "border-dashed cursor-pointer" : "cursor-grab"}`}
      style={{
        left: beatToX(run.startBeat, pxPerBeat),
        width,
        top: CURVE_INSET / 2,
        bottom: CURVE_INSET / 2,
        borderColor: paletteAccent(clip.color ?? track.color, chosen ? 1 : 0.65),
        background: paletteAccent(clip.color ?? track.color, chosen ? 0.3 : 0.14),
        boxShadow: chosen ? `0 0 0 1px ${accent}` : undefined,
      }}
    >
      <svg aria-hidden="true" className="absolute inset-0" width={width} height={height}>
        <polyline
          points={runCurve((beat) => clipValueAt(clip, beat), run, width, height)}
          fill="none"
          stroke={accent}
          strokeWidth={1.6}
        />
      </svg>
      <span className="absolute left-1.5 top-0 flex items-center gap-1 max-w-full pr-1 font-mono text-[9px] text-ink/80">
        {linked && <ChainIcon />}
        <span className="truncate">
          {clip.name}
          {labels[0] ? ` · ${labels[0].knob}` : ""}
        </span>
        {labels.length > 1 && <KnobList clip={clip} labels={labels} />}
      </span>
      {/* right-edge trim affordance, for a placed clip */}
      {!linked && <div className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize" />}
    </div>
  );
}

/** "+N": every knob a clip drives, with its device and range, opened from the clip. */
function KnobList({ clip, labels }: { clip: AutomationClipData; labels: ReturnType<typeof knobLabel>[] }) {
  return (
    <span onPointerDown={(event) => event.stopPropagation()} className="shrink-0">
      <Menu
        label={`What ${clip.name} drives`}
        align="left"
        trigger={`+${labels.length - 1}`}
        triggerClassName="px-1 rounded bg-control text-[9px] text-ink cursor-pointer"
        items={labels.map((label) => ({
          label: `${label.knob} · ${label.device}${label.range ? `, ${label.range}` : ""}`,
          disabled: true,
        }))}
      />
    </span>
  );
}
