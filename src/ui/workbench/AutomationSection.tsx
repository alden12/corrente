/**
 * The track's automation in the workbench column (DAW-67.5), between the roll and the devices: the
 * canvas's "Workbench" board. A rail of the track's automation clips in the header (+ a new one), and
 * open, the chosen clip's editor: what it drives on the left (and the segment controls), its curve
 * on the right with its name, length and where it plays above.
 *
 * The chosen clip is the one picked on the timeline or here (`automationSelection`), else the
 * track's first. Folded, the chips stay in the header to pick from.
 */
import { useState } from "react";
import type { Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import type { AutomationPoint, AutomationShape } from "../../audio/project/types";
import { AUTOMATION_SHAPES } from "../../audio/project/schema";
import { DEFAULT_DEPTH, DEFAULT_RATE } from "../../audio/automation/curve";
import { newAutomationId, newPlacementId } from "../../audio/commands/ids";
import { SectionHeader } from "../controls/SectionHeader";
import { BetaChip } from "../BetaChip";
import { IconButton } from "../controls/IconButton";
import { InlineRename } from "../InlineRename";
import { usePersistentBoolean } from "../usePersistent";
import { paletteAccent } from "../deviceColor";
import { BinIcon } from "../shellIcons";
import { automationSelection, newAutomationPoints, useAutomationSelection } from "../automation/automationSelection";
import { CurveEditor } from "../automation/CurveEditor";
import { DrivesList } from "../automation/DrivesList";

/** Each shape's little picture, as its button draws it (28 by 18). */
const SHAPE_ICONS: Record<AutomationShape, string> = {
  curve: "M2 16 C14 16 18 2 26 2",
  step: "M2 16 L14 16 L14 2 L26 2",
  sine: "M2 9 Q5 1 8 9 T14 9 T20 9 T26 9",
  triangle: "M2 16 L8 2 L14 16 L20 2 L26 16",
  saw: "M2 16 L10 2 L10 16 L18 2 L18 16 L26 2",
  square: "M2 16 L2 2 L8 2 L8 16 L14 16 L14 2 L20 2 L20 16 L26 16",
};
const SHAPE_NAMES: Record<AutomationShape, string> = {
  curve: "Line",
  step: "Step",
  sine: "Sine",
  triangle: "Triangle",
  saw: "Saw",
  square: "Square",
};
/** A wave's cycle, in beats, as note lengths. */
const RATES = [
  { label: "1/32", beats: 0.125 },
  { label: "1/16", beats: 0.25 },
  { label: "1/8", beats: 0.5 },
  { label: "1/4", beats: 1 },
  { label: "1/2", beats: 2 },
  { label: "1 bar", beats: 4 },
  { label: "2 bars", beats: 8 },
];

const isWave = (shape: AutomationShape | undefined) => shape !== undefined && shape !== "curve" && shape !== "step";

export function AutomationSection({
  track,
  dispatch,
  compact = false,
}: {
  track: Track;
  dispatch: Dispatch;
  compact?: boolean;
}) {
  const [open, setOpen] = usePersistentBoolean(`corrente:automation-open${compact ? ":compact" : ""}`, !compact);
  const chosen = useAutomationSelection();
  const clip =
    (chosen?.trackId === track.id && track.automations.find((automation) => automation.id === chosen.automationId)) ||
    track.automations[0];
  const [selectedPoint, setSelectedPoint] = useState<{ clipId: string; pointId: string } | null>(null);
  const pointId = selectedPoint && clip && selectedPoint.clipId === clip.id ? selectedPoint.pointId : null;
  const point = clip?.points.find((candidate) => candidate.id === pointId);

  const add = () => {
    const id = newAutomationId();
    dispatch({
      type: "addAutomation",
      trackId: track.id,
      id,
      points: newAutomationPoints(),
      placement: { id: newPlacementId(), startBeat: 0 },
    });
    automationSelection.set({ trackId: track.id, automationId: id });
    setOpen(true);
  };
  const editPoint = (patch: Partial<AutomationPoint>) =>
    clip &&
    point &&
    dispatch({
      type: "setAutomation",
      trackId: track.id,
      automationId: clip.id,
      points: clip.points.map((each) => (each.id === point.id ? { ...each, ...patch } : each)),
    });
  const linkedTo =
    clip?.linkedClipId && track.kind === "instrument"
      ? track.clips.find((note) => note.id === clip.linkedClipId)
      : undefined;
  const placements = clip ? track.automationPlacements.filter((placement) => placement.clipId === clip.id).length : 0;

  return (
    <section aria-label="Automation" data-testid="automation-section">
      <SectionHeader
        title="Automation"
        fold={{ open, onToggle: () => setOpen(!open) }}
        actions={
          <>
            {/* While it's being built (DAW-67): it will change, and parts of it are missing. */}
            <BetaChip title="Automation is new and still being built: expect it to change" />
            <IconButton label="Add automation" size={compact ? "md" : "sm"} onClick={add}>
              +
            </IconButton>
          </>
        }
      >
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {track.automations.map((automation) => {
            const picked = automation.id === clip?.id;
            const accent = paletteAccent(automation.color ?? track.color);
            return (
              <button
                key={automation.id}
                type="button"
                data-testid="automation-chip"
                aria-pressed={picked}
                onClick={() => {
                  automationSelection.set({ trackId: track.id, automationId: automation.id });
                  setOpen(true);
                }}
                className="h-6 pointer-coarse:h-9 px-2 shrink-0 flex items-center gap-1.5 rounded-full border text-[11px] cursor-pointer"
                style={{
                  borderColor: paletteAccent(automation.color ?? track.color, picked ? 1 : 0.5),
                  background: paletteAccent(automation.color ?? track.color, picked ? 0.28 : 0.1),
                }}
              >
                <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
                  <path d="M1 9 C5 9 7 1 13 1" fill="none" stroke={accent} strokeWidth="1.5" />
                </svg>
                {automation.name}
              </button>
            );
          })}
        </div>
      </SectionHeader>
      {open && !clip && (
        <p className="px-4 py-3 text-[12px] text-muted border-b border-line">
          No automation on this track yet. Add one, then bind the knobs it moves.
        </p>
      )}
      {open && clip && (
        <div className={`flex border-b border-line ${compact ? "flex-col" : ""}`}>
          <div
            className={`shrink-0 flex flex-col gap-4 p-3 bg-ground ${compact ? "border-b" : "w-64 border-r"} border-line`}
          >
            <DrivesList track={track} clip={clip} dispatch={dispatch} />
            <div className="flex flex-col gap-2" data-testid="segment-controls">
              <span className="font-mono text-[10px] tracking-[0.14em] text-faint">SEGMENT</span>
              {!point ? (
                <p className="text-[12px] text-muted">Pick a point to shape the segment after it.</p>
              ) : (
                <>
                  <div className="grid grid-cols-6 gap-1">
                    {AUTOMATION_SHAPES.map((shape) => {
                      const on = (point.shape ?? "curve") === shape;
                      return (
                        <button
                          key={shape}
                          type="button"
                          aria-label={SHAPE_NAMES[shape]}
                          aria-pressed={on}
                          title={SHAPE_NAMES[shape]}
                          onClick={() => editPoint({ shape: shape === "curve" ? undefined : shape })}
                          className={`h-8 pointer-coarse:h-11 grid place-items-center rounded-md border cursor-pointer ${
                            on ? "border-you bg-you/15 text-you" : "border-line text-muted hover:text-ink"
                          }`}
                        >
                          <svg width="24" height="16" viewBox="0 0 28 18" aria-hidden="true">
                            <path d={SHAPE_ICONS[shape]} fill="none" stroke="currentColor" strokeWidth="1.8" />
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!clip) return;
                      dispatch({
                        type: "setAutomation",
                        trackId: track.id,
                        automationId: clip.id,
                        points: clip.points.filter((each) => each.id !== point.id),
                      });
                      setSelectedPoint(null);
                    }}
                    className="self-start h-7 pointer-coarse:h-11 px-2.5 rounded-md text-[11px] text-muted hover:text-hot hover:bg-control cursor-pointer"
                  >
                    Delete point
                  </button>
                  {isWave(point.shape) && (
                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <label className="flex items-center gap-1.5">
                        Rate
                        <select
                          value={point.rate ?? DEFAULT_RATE}
                          onChange={(event) => editPoint({ rate: Number(event.target.value) })}
                          className="rounded bg-control px-1 py-0.5 font-mono text-ink"
                        >
                          {RATES.map((rate) => (
                            <option key={rate.beats} value={rate.beats}>
                              {rate.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5 flex-1">
                        Depth
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={point.depth ?? DEFAULT_DEPTH}
                          onChange={(event) => editPoint({ depth: Number(event.target.value) })}
                          className="flex-1 min-w-0"
                        />
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-3 px-3 h-10 border-b border-line-soft text-[12px]">
              <InlineRename
                value={clip.name}
                onCommit={(name) => dispatch({ type: "setAutomation", trackId: track.id, automationId: clip.id, name })}
                className="font-semibold text-strong min-w-0"
              />
              <label className="flex items-center gap-1.5 text-muted font-mono text-[11px]">
                <input
                  type="number"
                  aria-label="Length in beats"
                  min={0.25}
                  step={1}
                  value={clip.lengthBeats}
                  onChange={(event) =>
                    dispatch({
                      type: "setAutomation",
                      trackId: track.id,
                      automationId: clip.id,
                      lengthBeats: Number(event.target.value),
                    })
                  }
                  className="w-14 rounded bg-control px-1.5 py-0.5 text-ink"
                />
                beats
              </label>
              <span className="flex-1 min-w-0 truncate text-muted text-[11px]">
                {linkedTo
                  ? `Plays with ${linkedTo.name}`
                  : placements > 0
                    ? `On the timeline ${placements === 1 ? "once" : `${placements} times`}`
                    : "Not on the timeline yet"}
              </span>
              <IconButton
                label={`Delete ${clip.name}`}
                size="sm"
                tone="hot"
                onClick={() => {
                  dispatch({ type: "removeAutomation", trackId: track.id, automationId: clip.id });
                  automationSelection.set(null);
                }}
              >
                <BinIcon />
              </IconButton>
            </div>
            <CurveEditor
              track={track}
              clip={clip}
              selectedPoint={pointId}
              onSelectPoint={(id) => setSelectedPoint(id ? { clipId: clip.id, pointId: id } : null)}
              dispatch={dispatch}
              height={compact ? 160 : 200}
            />
          </div>
        </div>
      )}
    </section>
  );
}
