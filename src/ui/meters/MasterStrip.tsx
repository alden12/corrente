/**
 * The master, in the timeline's top-left corner above the track headers (DAW-8.5): a stereo meter on
 * the left, the master fader across the rest, and the peak in decibels at the end. Built for the
 * corner's 22px, and made to look unlike a track's fader so it reads as the whole mix rather than one
 * more track: two meter bars, one per side, a fader with a groove, marks at -24, -12, -6 and 0 dB
 * and a block handle, and a number. The number turns red while a clip is held; a click on it
 * clears it.
 *
 * The fader is the master volume (`setMasterVolume`), on the faders' decibel taper; the meter is
 * the mix after it, before the soft clip, so a red number means the master is being driven past
 * full scale and turning the master down is the fix.
 */
import { useMemo, useRef } from "react";
import { capturePointerDrag, releasePointerDrag } from "../dragGesture";
import { formatDecibels, gainOfPosition, positionOfGain } from "../controls/gainTaper";
import { useLevelSource, type LevelSource } from "./levelsContext";
import { useLevelMeter } from "./useLevelMeter";
import { METER_GRADIENT } from "./meterColors";

/** The decibel marks on the master's groove. */
const MARKS = [-24, -12, -6, 0].map((decibels) => ({
  decibels,
  left: positionOfGain(10 ** (decibels / 20)) * 100,
}));
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

function MeterBar({ read, label }: { read: (() => number) | undefined; label: string }) {
  const { bar } = useLevelMeter(read);
  return (
    <div aria-hidden="true" title={label} className="relative h-0.75 rounded-full bg-line overflow-hidden">
      <div
        ref={bar}
        className="absolute inset-0"
        style={{ background: METER_GRADIENT, clipPath: "inset(0 100% 0 0)" }}
      />
    </div>
  );
}

export function MasterStrip({ volume, onVolume }: { volume: number; onVolume: (volume: number) => void }) {
  const source = useLevelSource();
  const reads = useMemo(() => (source ? frameReads(source) : undefined), [source]);
  const { readout, reset } = useLevelMeter(reads?.louder);
  const grooveRef = useRef<HTMLDivElement>(null);
  const position = positionOfGain(volume);

  const setFromClientX = (clientX: number) => {
    const box = grooveRef.current?.getBoundingClientRect();
    if (box) onVolume(gainOfPosition((clientX - box.left) / box.width));
  };

  return (
    <div data-testid="master-strip" className="@container h-full flex items-center gap-2 pl-2.5 pr-1.5">
      <span className="font-mono text-[9px] tracking-[0.14em] text-muted shrink-0">MASTER</span>
      <div data-testid="master-meter" className="w-10 shrink-0 flex flex-col gap-px">
        <MeterBar read={reads?.left} label="Left" />
        <MeterBar read={reads?.right} label="Right" />
      </div>
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
        className="relative flex-1 min-w-10 h-4 cursor-pointer select-none touch-none"
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-sm bg-ground border border-line" />
        {MARKS.map((mark) => (
          <div
            key={mark.decibels}
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 w-px bg-line"
            style={{ left: `${mark.left}%` }}
          />
        ))}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-0.5 left-0 rounded-sm bg-you"
          style={{ width: `${position * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-you bg-panel"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <button
        type="button"
        onClick={reset}
        title="The master's peak, in dB: red after a clip. Click to clear."
        aria-label="Master peak"
        className="hidden @[12rem]:block w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted cursor-pointer"
      >
        <span ref={readout} data-testid="master-peak" className="data-[clipped=true]:text-hot">
          -∞
        </span>
      </button>
    </div>
  );
}
