/**
 * The devices' heading in the workbench column (DAW-61.1), sticky at the top once they scroll up to
 * it: the arrow that folds them all away, a chip per device that scrolls to it, and Save as patch.
 * Once the roll has scrolled off the top, a button back to it leads the bar, naming the clip open
 * in it, so moving between the notes and a device three rows down is one click either way.
 */
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import { SavePatchControl } from "./DeviceRack";
import { catalogEntry, EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import { effectCatalogEntry } from "../../audio/effects/catalog";
import { midiDeviceCatalogEntry } from "../../audio/midi/device/catalog";
import { deviceAccent } from "../deviceColor";
import { instrumentFold, useDeviceFolds } from "../devices/deviceFolds";
import { Menu, type MenuItem } from "../Menu";
import { PagedStrip } from "../controls/PagedStrip";
import { SectionHeader } from "../controls/SectionHeader";

interface Jump {
  /** The device's fold key, which its block carries as `data-device`. */
  key: string;
  label: string;
  color: string;
  /** Switched off: its dot is crossed through. */
  bypassed: boolean;
}

/** The track's devices in chain order, as jump targets. */
function jumpsFor(track: Track): Jump[] {
  const effects = track.effects.map((effect) => {
    const info = effectCatalogEntry(effect.type);
    return { key: effect.id, label: info.label, color: deviceAccent(info), bypassed: effect.bypassed };
  });
  if (track.kind !== "instrument") return effects;
  const midi = track.midiDevices.map((device) => {
    const info = midiDeviceCatalogEntry(device.type);
    return { key: device.id, label: info.label, color: deviceAccent(info), bypassed: device.bypassed };
  });
  const instrument = catalogEntry(track.instrumentType);
  const instruments =
    track.instrumentType === EMPTY_INSTRUMENT
      ? []
      : [{ key: instrumentFold(track.id), label: instrument.label, color: deviceAccent(instrument), bypassed: false }];
  return [...midi, ...instruments, ...effects];
}

export function DevicesBar({
  track,
  projectStore,
  open,
  onToggle,
  rollGone = false,
  onRoll,
  onDevice,
}: {
  track: Track;
  projectStore: ProjectStore;
  /** Whether the devices show, or are folded away under this bar. */
  open: boolean;
  onToggle: () => void;
  /** The roll has scrolled off the top, so the bar offers the way back. The plugin's window has no roll. */
  rollGone?: boolean;
  onRoll?: () => void;
  /** Scroll to the device with this fold key. */
  onDevice: (key: string) => void;
}) {
  const clip = track.clips.find((each) => each.id === track.activeClipId);
  const jumps = jumpsFor(track);
  const [, , putFolds] = useDeviceFolds();
  const keys = jumps.map((jump) => jump.key);
  const foldItems: MenuItem[] = [
    { label: "Fold all devices", onClick: () => putFolds(keys, true) },
    { label: "Open all devices", onClick: () => putFolds(keys, false) },
  ];
  return (
    <SectionHeader
      title="Devices"
      fold={{ open, onToggle }}
      className="sticky top-0 z-20"
      actions={
        track.kind === "instrument" && track.instrumentType !== EMPTY_INSTRUMENT ? (
          <SavePatchControl track={track} projectStore={projectStore} moreItems={[{ separator: true }, ...foldItems]} />
        ) : (
          <Menu label="Device chain actions" items={foldItems} />
        )
      }
    >
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
      <PagedStrip label="devices" count={jumps.length} className="gap-1">
        {jumps.map((jump) => (
          <button
            key={jump.key}
            type="button"
            onClick={() => onDevice(jump.key)}
            className="flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-muted hover:text-strong hover:bg-control cursor-pointer whitespace-nowrap"
          >
            <DeviceDot color={jump.color} bypassed={jump.bypassed} />
            {jump.label}
            {jump.bypassed && <span className="sr-only">(off)</span>}
          </button>
        ))}
      </PagedStrip>
    </SectionHeader>
  );
}

/** A device's colour; when it is switched off, a faded circle struck through in that colour. */
function DeviceDot({ color, bypassed }: { color: string; bypassed: boolean }) {
  if (!bypassed) return <span aria-hidden="true" className="w-2 h-2 rounded-sm" style={{ background: color }} />;
  return (
    <svg aria-hidden="true" data-bypassed="" viewBox="0 0 12 12" className="w-3 h-3 shrink-0 -mx-0.5">
      <circle cx="6" cy="6" r="4" fill={color} opacity="0.35" />
      <path d="M1 11 11 1" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
