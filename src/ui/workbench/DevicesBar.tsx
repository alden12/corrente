/**
 * The devices' heading in the workbench column (DAW-61.1), sticky at the top once they scroll up to
 * it: the arrow that folds them all away, a chip per device that scrolls to it, and Save as patch.
 */
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import { SavePatchControl } from "./DeviceRack";
import { EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import { DEVICE_CATALOGS, soundChain } from "../../audio/definitions/chainGraph";
import { deviceAccent } from "../deviceColor";
import { instrumentFold, useDeviceFolds } from "../devices/deviceFolds";
import { Menu, type MenuItem } from "../Menu";
import { openChainGraph, useCanOpenGraphs } from "../tabs/openGraph";
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

/** The track's devices in chain order, as jump targets: an instrument by its fold, the rest by their ids. */
const jumpsFor = (track: Track): Jump[] =>
  soundChain(track.kind === "instrument" ? track : { effects: track.effects })
    .filter((device) => device.type !== EMPTY_INSTRUMENT)
    .map((device) => {
      const info = DEVICE_CATALOGS[device.kind](device.type);
      return {
        key: device.id ?? instrumentFold(track.id),
        label: info.label,
        color: deviceAccent(info),
        bypassed: !!device.bypassed,
      };
    });

export function DevicesBar({
  track,
  projectStore,
  open,
  onToggle,
  onDevice,
}: {
  track: Track;
  projectStore: ProjectStore;
  /** Whether the devices show, or are folded away under this bar. */
  open: boolean;
  onToggle: () => void;
  /** Scroll to the device with this fold key. */
  onDevice: (key: string) => void;
}) {
  const jumps = jumpsFor(track);
  const { putAll: putFolds } = useDeviceFolds();
  const keys = jumps.map((jump) => jump.key);
  // The whole chain's graph (INST-44.2), where there's somewhere to show it.
  const chainGraph = useCanOpenGraphs() && track.kind === "instrument" && track.instrumentType !== EMPTY_INSTRUMENT;
  const foldItems: MenuItem[] = [
    ...(chainGraph ? [{ label: "View chain graph", onClick: () => openChainGraph(track.id) }] : []),
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
