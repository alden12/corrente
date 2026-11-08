/**
 * An automation clip's curve, to draw on (DAW-67.5): the canvas's "Automation clip editor" board.
 *
 * - **Points**: press empty space to add one there (and keep dragging it), drag one to move it,
 *   double-click one (or select it and press Delete) to remove it. Beats snap to a sixteenth of a
 *   bar's beat grid unless Alt is held.
 * - **Bend**: drag a segment's line up or down to bend it.
 * - **The axis** reads in the first knob's units ("4.0 kHz"), the curve's 0..1 mapped into its range.
 * - **The track's other clips** are drawn dashed behind, so two curves meant to work together can.
 *
 * Every change is one `setAutomation` with the whole curve; a drag coalesces into one undo step.
 * The selected point is the one the segment controls (shape, rate, depth) change.
 */
import { useEffect, useRef, useState } from "react";
import type { Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import type { AutomationClipData, AutomationPoint } from "../../audio/project/types";
import { valueAt } from "../../audio/automation/curve";
import { boundValue } from "../../audio/automation/playback";
import { knobStore } from "../../audio/automation/player";
import { newAutomationPointId } from "../../audio/commands/ids";
import { beginPointerDrag } from "../pointerDrag";
import { formatNumber } from "../paramFormat";
import { paletteAccent } from "../deviceColor";

const PAD = 10;
/** Beats a point lands on: a sixteenth note, unless Alt is held. */
const SNAP = 0.25;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function CurveEditor({
  track,
  clip,
  selectedPoint,
  onSelectPoint,
  dispatch,
  height = 180,
}: {
  track: Track;
  clip: AutomationClipData;
  selectedPoint: string | null;
  onSelectPoint: (id: string | null) => void;
  dispatch: Dispatch;
  height?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const length = clip.lengthBeats;
  const innerW = Math.max(1, width - 2 * PAD);
  const innerH = height - 2 * PAD;
  const xOf = (beat: number) => PAD + (beat / length) * innerW;
  const yOf = (value: number) => PAD + (1 - value) * innerH;
  const at = (clientX: number, clientY: number, free: boolean) => {
    const box = ref.current!.getBoundingClientRect();
    const raw = ((clientX - box.left - PAD) / innerW) * length;
    return {
      beat: clamp(free ? raw : Math.round(raw / SNAP) * SNAP, 0, length),
      value: clamp(1 - (clientY - box.top - PAD) / innerH, 0, 1),
    };
  };

  const write = (points: AutomationPoint[]) =>
    dispatch({ type: "setAutomation", trackId: track.id, automationId: clip.id, points });

  /** Drag a point: `points` is the curve with it in, as the drag began. */
  const dragPoint = (id: string, points: AutomationPoint[]) =>
    beginPointerDrag((move) => {
      const { beat, value } = at(move.clientX, move.clientY, move.altKey);
      write(points.map((point) => (point.id === id ? { ...point, beat, value } : point)));
    });

  const onBackground = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const { beat, value } = at(event.clientX, event.clientY, event.altKey);
    const point: AutomationPoint = { id: newAutomationPointId(), beat, value };
    const points = [...clip.points, point];
    write(points);
    onSelectPoint(point.id);
    dragPoint(point.id, points);
  };

  const onPoint = (point: AutomationPoint, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelectPoint(point.id);
    dragPoint(point.id, clip.points);
  };

  /** Bend the segment starting at `from` by dragging its line: up eases out, down eases in. */
  const onSegment = (from: AutomationPoint, event: React.PointerEvent) => {
    if (event.button !== 0 || (from.shape ?? "curve") !== "curve") return;
    event.stopPropagation();
    onSelectPoint(from.id);
    const startY = event.clientY;
    const startBend = from.bend ?? 0;
    const rising = (clip.points[clip.points.indexOf(from) + 1]?.value ?? from.value) >= from.value;
    beginPointerDrag((move) => {
      const shift = ((startY - move.clientY) / innerH) * 2 * (rising ? 1 : -1);
      const bend = Math.round(clamp(startBend + shift, -1, 1) * 100) / 100;
      write(clip.points.map((point) => (point.id === from.id ? { ...point, bend } : point)));
    });
  };

  const remove = (id: string) => {
    write(clip.points.filter((point) => point.id !== id));
    onSelectPoint(null);
  };

  const sampled = (points: readonly AutomationPoint[]) =>
    width > 0
      ? Array.from({ length: Math.ceil(innerW / 2) + 1 }, (_, index) => {
          const beat = Math.min(length, (index * 2 * length) / innerW);
          return `${xOf(beat).toFixed(1)},${yOf(valueAt(points, beat) ?? 0).toFixed(1)}`;
        }).join(" ")
      : "";

  // The axis in the first knob's units: four marks, at the knob's values for 0, 1/3, 2/3 and 1.
  const first = clip.bindings[0];
  const store = first && knobStore(track, first);
  const spec = store && first ? store.spec(first.param) : undefined;
  const marks = [1, 2 / 3, 1 / 3, 0].map((value) => ({
    value,
    label:
      spec?.kind === "number" && first ? formatNumber(spec, boundValue(first, value)) : `${Math.round(value * 100)}%`,
  }));
  const accent = paletteAccent(clip.color ?? track.color);
  const others = track.automations.filter((other) => other.id !== clip.id && other.points.length > 0);

  return (
    <div className="relative flex">
      <div className="w-16 shrink-0 relative font-mono text-[10px] text-muted" style={{ height }} aria-hidden="true">
        {marks.map((mark) => (
          <span key={mark.value} className="absolute right-2 -translate-y-1/2" style={{ top: yOf(mark.value) }}>
            {mark.label}
          </span>
        ))}
      </div>
      <svg
        ref={ref}
        data-testid="curve-editor"
        role="application"
        aria-label={`${clip.name}'s curve`}
        tabIndex={0}
        className="flex-1 min-w-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-you bg-recess"
        height={height}
        onPointerDown={onBackground}
        onKeyDown={(event) => {
          if ((event.key === "Delete" || event.key === "Backspace") && selectedPoint) {
            event.preventDefault();
            event.stopPropagation();
            remove(selectedPoint);
          }
        }}
      >
        {/* The bar grid: a line a beat, stronger every four. */}
        {Array.from({ length: Math.floor(length) + 1 }, (_, beat) => (
          <line
            key={beat}
            x1={xOf(beat)}
            x2={xOf(beat)}
            y1={PAD}
            y2={height - PAD}
            stroke="var(--color-line)"
            strokeOpacity={beat % 4 === 0 ? 1 : 0.4}
          />
        ))}
        {marks.map((mark) => (
          <line
            key={mark.value}
            x1={PAD}
            x2={width - PAD}
            y1={yOf(mark.value)}
            y2={yOf(mark.value)}
            stroke="var(--color-line-soft)"
          />
        ))}
        {others.map((other) => (
          <polyline
            key={other.id}
            points={sampled(other.points)}
            fill="none"
            stroke="var(--color-muted)"
            strokeOpacity={0.5}
            strokeDasharray="4 4"
            pointerEvents="none"
          />
        ))}
        <polyline points={sampled(clip.points)} fill="none" stroke={accent} strokeWidth={2.5} pointerEvents="none" />
        {/* Each segment's line, wide and clear, to bend by dragging. */}
        {clip.points.slice(0, -1).map((point, index) => {
          const next = clip.points[index + 1];
          const segment = clip.points.slice(index, index + 2);
          const across = Array.from({ length: 9 }, (_, step) => {
            const beat = point.beat + ((next.beat - point.beat) * step) / 8;
            return `${xOf(beat)},${yOf(valueAt(segment, beat) ?? point.value)}`;
          }).join(" ");
          return (
            <polyline
              key={point.id}
              data-testid="curve-segment"
              points={across}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              className={(point.shape ?? "curve") === "curve" ? "cursor-ns-resize" : ""}
              onPointerDown={(event) => onSegment(point, event)}
            />
          );
        })}
        {clip.points.map((point) => (
          <circle
            key={point.id}
            data-testid="curve-point"
            data-selected={point.id === selectedPoint}
            cx={xOf(point.beat)}
            cy={yOf(point.value)}
            r={point.id === selectedPoint ? 7 : 5}
            fill={point.id === selectedPoint ? accent : "var(--color-ground)"}
            stroke={point.id === selectedPoint ? "var(--color-ink)" : accent}
            strokeWidth={2}
            className="cursor-grab"
            onPointerDown={(event) => onPoint(point, event)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              remove(point.id);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
