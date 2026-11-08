/**
 * The master, in the timeline's top-left corner above the track headers (DAW-8.5): one meter-fader
 * across the corner, then the peak in decibels.
 *
 * - **The groove is the meter:** two bars, left over right, filling from the left on the meters'
 *   scale (`meterScale`): green, amber over -6 dB, red over -1 dB. Past the 0 dB mark the groove
 *   carries on into a red-tinted over zone up to +6 dB, since the master sums ahead of its soft clip
 *   and can go over: you see how far, not just that it did.
 * - **The caret above the groove is the master volume** (`setMasterVolume`), on the faders' taper,
 *   topping out at 0 dB. It sits on the groove's top edge, with a hairline down, so it marks the
 *   volume without covering the level. Drag anywhere on the strip; arrow keys nudge.
 * - **The number** is the recent peak, red while a clip is held; a click clears it.
 *
 * Marks at -24, -12, -6 and 0 dB. It reads as the whole mix, and apart from the tracks' knobs.
 */
import { useMemo, useRef } from "react";
import { capturePointerDrag, releasePointerDrag } from "../dragGesture";
import { formatDecibels, gainOfPosition, positionOfGain } from "../controls/gainTaper";
import { useLevelSource, type LevelSource } from "./levelsContext";
import { useLevelMeter } from "./useLevelMeter";
import { METER_GRADIENT, ZERO_AT, meterPosition } from "./meterScale";

/** The decibel marks along the groove. */
const MARKS = [-24, -12, -6, 0].map((decibels) => ({ decibels, left: meterPosition(10 ** (decibels / 20)) * 100 }));
const KEY_STEP = 0.05;

/** One read of the master a frame, shared by the meters: left, right and the louder of the two. */
function frameReads(source: LevelSource) {
  let at = -1;
  let levels: [number, number] = [0, 0];
  const read = () => {
    const now = performance.now();
    if (now - at > 4) {
      levels = source.masterLevels();
      at = now;
    }
    return levels;
  };
  return { left: () => read()[0], right: () => read()[1], louder: () => Math.max(...read()) };
}

/** One side's bar in the groove, with its peak mark. */
function MeterBar({ read, label }: { read: (() => number) | undefined; label: string }) {
  const { bar, peak } = useLevelMeter(read);
  return (
    <div aria-hidden="true" title={label} className="relative h-1 overflow-hidden">
      <div
        ref={bar}
        data-testid="master-meter-bar"
        className="absolute inset-0"
        style={{ background: METER_GRADIENT, clipPath: "inset(0 100% 0 0)" }}
      />
      <div ref={peak} className="absolute inset-y-0 w-px bg-ink/70" style={{ opacity: 0 }} />
    </div>
  );
}

export function MasterStrip({ volume, onVolume }: { volume: number; onVolume: (volume: number) => void }) {
  const source = useLevelSource();
  const reads = useMemo(() => (source ? frameReads(source) : undefined), [source]);
  const { readout, reset } = useLevelMeter(reads?.louder);
  const grooveRef = useRef<HTMLDivElement>(null);
  const position = positionOfGain(volume);
  /** Where the caret sits along the groove: the fader's travel ends at the 0 dB mark. */
  const caret = position * ZERO_AT * 100;

  const setFromClientX = (clientX: number) => {
    const box = grooveRef.current?.getBoundingClientRect();
    if (box) onVolume(gainOfPosition((clientX - box.left) / box.width / ZERO_AT));
  };

  return (
    <div data-testid="master-strip" className="@container h-full flex items-center gap-2 pl-2.5 pr-1.5">
      <span className="font-mono text-[9px] tracking-[0.14em] text-muted shrink-0">MASTER</span>
      <div
        ref={grooveRef}
        role="slider"
        aria-label="Master volume"
        aria-valuenow={Math.round(position * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={formatDecibels(volume)}
        tabIndex={0}
        title={`Master volume: ${formatDecibels(volume)}`}
        onPointerDown={(event) => {
          capturePointerDrag(event);
          setFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons) setFromClientX(event.clientX);
        }}
        onPointerUp={releasePointerDrag}
        onPointerCancel={releasePointerDrag}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") onVolume(gainOfPosition(position - KEY_STEP));
          if (event.key === "ArrowRight" || event.key === "ArrowUp") onVolume(gainOfPosition(position + KEY_STEP));
        }}
        className="relative flex-1 min-w-12 h-full cursor-pointer select-none touch-none"
      >
        {/* The groove: the two sides' bars, the over zone tinted past 0 dB, and the marks. */}
        <div
          data-testid="master-meter"
          className="absolute inset-x-0 bottom-1 flex flex-col gap-px p-px rounded-[3px] bg-ground border border-line overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 bg-hot/15"
            style={{ left: `${ZERO_AT * 100}%` }}
          />
          <MeterBar read={reads?.left} label="Left" />
          <MeterBar read={reads?.right} label="Right" />
        </div>
        {MARKS.map((mark) => (
          <div
            key={mark.decibels}
            aria-hidden="true"
            className={`absolute bottom-0 h-1 w-px ${mark.decibels === 0 ? "bg-muted" : "bg-line"}`}
            style={{ left: `${mark.left}%` }}
          />
        ))}
        {/* The volume: a caret on the groove's top edge and a hairline down through it. */}
        <div
          aria-hidden="true"
          className="absolute top-0.5 bottom-1 w-0 pointer-events-none"
          style={{ left: `${caret}%` }}
        >
          <div className="absolute top-0 -translate-x-1/2 w-0 h-0 border-x-[4px] border-x-transparent border-t-[5px] border-t-you" />
          <div className="absolute top-1 bottom-0 -translate-x-1/2 w-px bg-you/70" />
        </div>
      </div>
      <button
        type="button"
        onClick={reset}
        title="The master's peak, in dB: red after a clip. Click to clear."
        aria-label="Master peak"
        className="hidden @[12rem]:block w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted cursor-pointer"
      >
        <span ref={readout} data-testid="master-peak" className="data-[clipped=true]:text-hot">
          -∞
        </span>
      </button>
    </div>
  );
}
