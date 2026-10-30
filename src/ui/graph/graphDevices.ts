/**
 * The devices a graph tab draws (INST-44, INST-44.2), in chain order and named from the catalogs: one
 * device, a track's chain as it stands now, or the chain a patch's tab carries.
 */
import { soundChain, type ChainDevice, type ChainEntry, type DeviceKind } from "../../audio/definitions/chainGraph";
import { effectCatalogEntry } from "../../audio/effects/catalog";
import { catalogEntry } from "../../audio/instruments/catalog";
import { midiDeviceCatalogEntry } from "../../audio/midi/device/catalog";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { TabTarget } from "../tabs/editorTabs";

const LABELS: Record<DeviceKind, (type: string) => string> = {
  midi: (type) => midiDeviceCatalogEntry(type).label,
  instrument: (type) => catalogEntry(type).label,
  effect: (type) => effectCatalogEntry(type).label,
};

const named = (device: ChainEntry): ChainDevice => ({
  ...device,
  label: LABELS[device.kind](device.type),
});

export function graphDevices(target: Exclude<TabTarget, { kind: "track" }>, project: ProjectStore): ChainDevice[] {
  if (target.kind === "graph") return [named({ kind: target.device, type: target.type })];
  if (target.kind === "patch") return target.chain.map(named);
  const track = project.getTrack(target.trackId);
  return track?.kind === "instrument" ? soundChain(track).map(named) : [];
}
