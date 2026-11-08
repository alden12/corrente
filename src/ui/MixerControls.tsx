/**
 * Shared mixer controls for the track/group headers: a low-profile Fader and an adjoined Mute/Solo
 * button pair.
 *
 * The Fader is a volume, on a decibel taper (`gainTaper`), and given `meter` its track is the level
 * meter too (DAW-8.5): the level fills it from the left, green, then amber over -6 dB and red at
 * the top, a peak mark waits at the loudest recent level, and a sample at full scale lights the cap
 * at its right end for a few seconds. The meter never draws past the end: the end is 0 dBFS.
 */
import { useRef } from "react";
import { capturePointerDrag, releasePointerDrag } from "./dragGesture";
import { formatDecibels, gainOfPosition, positionOfGain } from "./controls/gainTaper";
import { useLevelMeter } from "./meters/useLevelMeter";
import { METER_GRADIENT } from "./meters/meterColors";

/** A step of the arrow keys, in fader travel. */
const KEY_STEP = 0.05;

export function Fader({
  value,
  onChange,
  title,
  width = 56,
  max = 1,
  meter,
  onPointerDownCapture,
}: {
  value: number;
  onChange: (v: number) => void;
  title?: string;
  width?: number;
  /** Top of the range (default 1). Clip gain uses >1 to allow a boost. */
  max?: number;
  /** The live level to meter (the loudest sample since the last frame, as a gain); none, no meter. */
  meter?: () => number;
  onPointerDownCapture?: (e: React.PointerEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { bar: meterBar, peak: meterPeak, clip: meterClip } = useLevelMeter(meter);
  const position = positionOfGain(value, max);
  const label = `${title ?? "Volume"}: ${formatDecibels(value)}`;

  const setFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange(gainOfPosition((clientX - r.left) / r.width, max));
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={title}
      aria-valuenow={Math.round(position * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={formatDecibels(value)}
      tabIndex={0}
      title={label}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={(e) => {
        capturePointerDrag(e);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons) setFromClientX(e.clientX);
      }}
      onPointerUp={releasePointerDrag}
      onPointerCancel={releasePointerDrag}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(gainOfPosition(position - KEY_STEP, max));
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(gainOfPosition(position + KEY_STEP, max));
      }}
      className="relative h-4 shrink-0 cursor-pointer select-none touch-none"
      style={{ width }}
    >
      {meter ? (
        // The track is the meter: the level revealed from the left over the colours, the peak mark,
        // and the clip cap at the right end. The handle alone says where the volume is.
        <div
          data-testid="level-meter"
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-line overflow-hidden"
        >
          <div
            ref={meterBar}
            data-testid="level-meter-bar"
            className="absolute inset-0"
            style={{ background: METER_GRADIENT, clipPath: "inset(0 100% 0 0)" }}
          />
          <div ref={meterPeak} className="absolute inset-y-0 w-0.5 -ml-px bg-ink/60" style={{ opacity: 0 }} />
          <div
            ref={meterClip}
            data-testid="level-meter-clip"
            className="absolute inset-y-0 right-0 w-1 bg-hot"
            style={{ opacity: 0 }}
          />
        </div>
      ) : (
        // The track, and the accent as the filled portion - the same rule the knobs and the device
        // faders follow, so the three read as one family.
        <>
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-line" />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-you"
            style={{ width: `${position * 100}%` }}
          />
        </>
      )}
      {/* A 9px ring handle. Small on purpose: the row is 46px tall and the name has to fit
          beside it. The hit area is the whole 16px-tall track, not this. */}
      <div
        className="absolute top-1/2 w-2.25 h-2.25 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-you bg-panel"
        style={{ left: `${position * 100}%` }}
      />
    </div>
  );
}

/** `compact` for the arrangement's headers; `tree` for the project tree's short rows; `row` where
 *  the pair is a touch target in a list (and grows with the panel's container width). */
const MUTE_SOLO_SIZE = {
  compact: "font-mono text-[10px] leading-none w-5 h-6",
  /** The project tree's 26px rows (DAW-83): short enough to clear the row's edges. */
  tree: "font-mono text-[10px] leading-none w-5 h-5",
  row: "font-mono text-[12px] font-semibold leading-none w-7 h-7 @[17rem]:w-8 @[17rem]:h-8 pointer-coarse:w-9 pointer-coarse:h-9",
} as const;

export function MuteSolo({
  muted,
  solo,
  onMute,
  onSolo,
  name,
  size = "compact",
}: {
  muted: boolean;
  solo: boolean;
  onMute: () => void;
  onSolo: () => void;
  /** What is muted, for the buttons' accessible names ("Mute Bass"); a list of rows needs it. */
  name?: string;
  size?: keyof typeof MUTE_SOLO_SIZE;
}) {
  // Hairline: the outline carries the shape and nothing fills it, so a row of tracks reads as
  // a row of names rather than a column of grey chips. The fill is what "on" means here, which
  // is the same rule the buttons follow - emphasis belongs to state, not to the control.
  const btn = `${MUTE_SOLO_SIZE[size]} cursor-pointer transition-colors`;
  const resting = "text-muted hover:text-ink hover:bg-control";
  const labelled = (action: string) => (name ? `${action} ${name}` : undefined);
  return (
    <div className="flex shrink-0 rounded-md border border-line overflow-hidden">
      <button
        type="button"
        title={muted ? "Unmute" : "Mute"}
        aria-label={labelled(muted ? "Unmute" : "Mute")}
        aria-pressed={muted}
        onClick={(e) => {
          e.stopPropagation();
          onMute();
        }}
        className={`${btn} ${muted ? "bg-hot/20 text-hot" : resting}`}
      >
        M
      </button>
      <button
        type="button"
        title={solo ? "Unsolo" : "Solo"}
        aria-label={labelled(solo ? "Unsolo" : "Solo")}
        aria-pressed={solo}
        onClick={(e) => {
          e.stopPropagation();
          onSolo();
        }}
        className={`${btn} border-l border-line ${solo ? "bg-warn/25 text-warn" : resting}`}
      >
        S
      </button>
    </div>
  );
}
