/**
 * A track's or group's volume, as a small knob whose ring is its level meter (DAW-8.5). A fader
 * across each header crowded the names and read as the master's smaller twin; a knob takes a third
 * of the room, and the ring gives the meter a place of its own.
 *
 * - **The tick is the volume**, on the faders' decibel taper (`gainTaper`), 0 dB at the end of its
 *   travel. Drag up or down, arrow keys to nudge, double-click for 0 dB.
 * - **The ring is the level** after the volume, on the meters' scale (`meterScale`): it fills
 *   clockwise, green, amber over -6 dB and red over -1 dB, with a mark at the recent peak. Past the
 *   tick's travel the ring carries on into a short red-tinted over zone, 0 to +6 dB, lit solid for
 *   a few seconds after a clip.
 *
 * The ring is a conic gradient repainted each frame by `useMeterFrames`, so no meter re-renders.
 */
import { useRef } from "react";
import { capturePointerDrag, releasePointerDrag } from "../dragGesture";
import { formatDecibels, gainOfPosition, positionOfGain } from "./gainTaper";
import { useMeterFrames } from "../meters/useLevelMeter";
import { AMBER_AT, RED_AT, ZERO_AT, meterPosition } from "../meters/meterScale";

/** The ring's sweep: 0 dB at 270 degrees, the over zone to 300, starting at seven o'clock. */
const SWEEP = 300;
const START = 210;
/** Fader travel per pixel dragged. */
const DRAG = 1 / 150;
const KEY_STEP = 0.05;

/** The ring for a level and peak (meter positions 0..1), lit over the top while `clipped`. */
function ring(level: number, peak: number, clipped: boolean): string {
  const at = (position: number) => position * SWEEP;
  const fill = at(level);
  const colored = [
    ["var(--color-good)", 0, at(AMBER_AT)],
    ["var(--color-warn)", at(AMBER_AT), at(RED_AT)],
    ["var(--color-hot)", at(RED_AT), SWEEP],
  ] as const;
  const filled = colored
    .filter(([, from]) => from < fill)
    .map(([color, from, to]) => `${color} ${from}deg ${Math.min(to, fill)}deg`);
  const zero = at(ZERO_AT);
  const track = fill < zero ? [`var(--color-line) ${fill}deg ${zero}deg`] : [];
  const overFrom = Math.max(fill, zero);
  const over = clipped
    ? `var(--color-hot) ${overFrom}deg ${SWEEP}deg`
    : `color-mix(in oklab, var(--color-hot) 30%, var(--color-line)) ${overFrom}deg ${SWEEP}deg`;
  const mark = at(peak);
  const stops = [...filled, ...track, over, `transparent ${SWEEP}deg 360deg`].join(", ");
  // The peak mark: a thin sliver of ink laid over the ring by a second gradient.
  const peakMark =
    peak > 0.01
      ? `conic-gradient(from ${START}deg, transparent ${mark - 4}deg, var(--color-ink) ${mark - 4}deg ${mark}deg, transparent ${mark}deg), `
      : "";
  return `${peakMark}conic-gradient(from ${START}deg, ${stops})`;
}

export function VolumeKnob({
  value,
  onChange,
  title,
  meter,
}: {
  /** The volume, a gain 0..1. */
  value: number;
  onChange: (volume: number) => void;
  title: string;
  /** The live level to meter (the loudest sample since the last frame, as a gain); none, no meter. */
  meter?: () => number;
}) {
  const ringRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; start: number } | null>(null);
  const position = positionOfGain(value);

  useMeterFrames(meter, (state, now) => {
    const element = ringRef.current;
    if (!element) return;
    const level = meterPosition(state.level);
    element.style.background = ring(level, meterPosition(state.peak), now < state.clipUntil);
    element.dataset.level = level.toFixed(3);
  });

  return (
    <div
      ref={ringRef}
      role="slider"
      aria-label={title}
      aria-valuenow={Math.round(position * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={formatDecibels(value)}
      tabIndex={0}
      title={`${title}: ${formatDecibels(value)}`}
      data-testid="volume-knob"
      data-level="0"
      onPointerDown={(event) => {
        event.stopPropagation();
        capturePointerDrag(event);
        drag.current = { startY: event.clientY, start: position };
      }}
      onPointerMove={(event) => {
        if (!drag.current || !event.buttons) return;
        onChange(gainOfPosition(drag.current.start - (event.clientY - drag.current.startY) * DRAG));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        releasePointerDrag(event);
      }}
      onPointerCancel={(event) => {
        drag.current = null;
        releasePointerDrag(event);
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onChange(1);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") onChange(gainOfPosition(position - KEY_STEP));
        if (event.key === "ArrowRight" || event.key === "ArrowUp") onChange(gainOfPosition(position + KEY_STEP));
      }}
      className="relative w-6 h-6 shrink-0 rounded-full cursor-ns-resize touch-none select-none focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-2"
      style={{ background: ring(0, 0, false) }}
    >
      {/* Punches the middle out, so the ring reads as a track rather than a pie. */}
      <span className="absolute inset-[3px] rounded-full bg-panel" />
      {/* The volume's tick: 0 dB is the end of its travel, where the over zone begins. */}
      <span
        className="absolute left-1/2 top-[4px] w-0.5 h-1.5 rounded-full bg-you origin-[50%_8px]"
        style={{ transform: `translateX(-50%) rotate(${START + position * ZERO_AT * SWEEP - 360}deg)` }}
      />
    </div>
  );
}
