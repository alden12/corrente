/**
 * The devices' heading in the workbench column (DAW-61.1), sticky at the top once they scroll up to
 * it: the arrow that folds them all away, a chip per device that scrolls to it, and Save as patch.
 * Once the roll has scrolled off the top, a button back to it leads the bar, naming the clip open
 * in it, so moving between the notes and a device three rows down is one click either way.
 */
import { useRef } from "react";
import type { Track } from "../../audio/project/projectStore";
import { SavePatchControl } from "./DeviceRack";
import { catalogEntry, EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import { effectCatalogEntry } from "../../audio/effects/catalog";
import { midiDeviceCatalogEntry } from "../../audio/midi/device/catalog";
import { deviceAccent } from "../deviceColor";
import { instrumentFold } from "../devices/deviceFolds";
import { edgeFade, useScrollEnds } from "../scrollFade";
import { FoldButton } from "../controls/FoldButton";

interface Jump {
  /** The device's fold key, which its block carries as `data-device`. */
  key: string;
  label: string;
  color: string;
}

/** The track's devices in chain order, as jump targets. */
function jumpsFor(track: Track): Jump[] {
  const effects = track.effects.map((effect) => {
    const info = effectCatalogEntry(effect.type);
    return { key: effect.id, label: info.label, color: deviceAccent(info) };
  });
  if (track.kind !== "instrument") return effects;
  const midi = track.midiDevices.map((device) => {
    const info = midiDeviceCatalogEntry(device.type);
    return { key: device.id, label: info.label, color: deviceAccent(info) };
  });
  const instrument = catalogEntry(track.instrumentType);
  const instruments =
    track.instrumentType === EMPTY_INSTRUMENT
      ? []
      : [{ key: instrumentFold(track.id), label: instrument.label, color: deviceAccent(instrument) }];
  return [...midi, ...instruments, ...effects];
}

export function DevicesBar({
  track,
  open,
  onToggle,
  rollGone,
  onRoll,
  onDevice,
}: {
  track: Track;
  /** Whether the devices show, or are folded away under this bar. */
  open: boolean;
  onToggle: () => void;
  /** The roll has scrolled off the top, so the bar offers the way back. */
  rollGone: boolean;
  onRoll: () => void;
  /** Scroll to the device with this fold key. */
  onDevice: (key: string) => void;
}) {
  const clip = track.clips.find((each) => each.id === track.activeClipId);
  const jumps = jumpsFor(track);
  const chips = useRef<HTMLDivElement>(null);
  const ends = useScrollEnds(chips, jumps.length);
  return (
    <div className="sticky top-0 z-20 flex items-center gap-1.5 h-11 pl-1.5 pr-3 border-b border-line bg-frame">
      <FoldButton fold={{ open, onToggle }} label="devices" />
      {rollGone && (
        <button
          type="button"
          onClick={onRoll}
          className="flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-md bg-control text-[12px] text-ink hover:text-strong cursor-pointer shrink-0"
        >
          <span aria-hidden="true" className="text-[16px] leading-none -rotate-90">
            ▸
          </span>
          {track.kind === "instrument" ? "Roll" : "Clip"}
          {clip && <span className="font-mono text-[11px] text-you truncate max-w-40">{clip.name}</span>}
        </button>
      )}
      <span className="px-1.5 font-mono text-[10px] tracking-[0.16em] uppercase text-faint shrink-0">Devices</span>
      {/* Faded where there are more chips to scroll to, as Explore's shelves are. */}
      <div
        ref={chips}
        className="flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-none"
        style={{ maskImage: edgeFade(ends), WebkitMaskImage: edgeFade(ends) }}
      >
        {jumps.map((jump) => (
          <button
            key={jump.key}
            type="button"
            onClick={() => onDevice(jump.key)}
            className="flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-muted hover:text-strong hover:bg-control cursor-pointer whitespace-nowrap"
          >
            <span aria-hidden="true" className="w-2 h-2 rounded-sm" style={{ background: jump.color }} />
            {jump.label}
          </button>
        ))}
      </div>
      {track.kind === "instrument" && track.instrumentType !== EMPTY_INSTRUMENT && (
        <span className="ml-auto pl-2 shrink-0">
          <SavePatchControl track={track} />
        </span>
      )}
    </div>
  );
}
