/**
 * The slim bar the workbench column shows once its roll has scrolled away (DAW-61.1): one button
 * back up to the roll, naming the clip open in it, and a chip per device that scrolls to it. It
 * stands in for the roll's place at the top, so moving between the notes and a device three rows
 * down is one click either way.
 */
import type { Track } from "../../audio/project/projectStore";
import { catalogEntry, EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import { effectCatalogEntry } from "../../audio/effects/catalog";
import { midiDeviceCatalogEntry } from "../../audio/midi/device/catalog";
import { deviceAccent } from "../deviceColor";
import { instrumentFold } from "../devices/deviceFolds";

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

export function ReturnBar({
  track,
  onRoll,
  onDevice,
}: {
  track: Track;
  /** Scroll back up to the roll. */
  onRoll: () => void;
  /** Scroll to the device with this fold key. */
  onDevice: (key: string) => void;
}) {
  const clip = track.clips.find((each) => each.id === track.activeClipId);
  return (
    <div className="absolute inset-x-0 top-0 h-10 flex items-center gap-2 px-3 border-b border-line bg-frame/95 backdrop-blur-sm">
      <button
        type="button"
        onClick={onRoll}
        className="flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-md bg-control text-[12px] text-ink hover:text-strong cursor-pointer"
      >
        <span aria-hidden="true" className="text-[16px] leading-none -rotate-90">
          ▸
        </span>
        {track.kind === "instrument" ? "Roll" : "Clip"}
        {clip && <span className="font-mono text-[11px] text-you truncate max-w-40">{clip.name}</span>}
      </button>
      <span className="ml-2 text-[11px] text-faint shrink-0">Jump to</span>
      <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
        {jumpsFor(track).map((jump) => (
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
    </div>
  );
}
