/**
 * The devices a graph tab draws (INST-44, INST-44.2), in chain order and named from the catalogs: one
 * device, a track's chain as it stands now, or the chain a patch's tab carries.
 */
import { DEVICE_CATALOGS, soundChain, type ChainDevice, type ChainEntry } from "../../audio/definitions/chainGraph";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { GraphTarget } from "../tabs/openGraph";

const named = (device: ChainEntry): ChainDevice => ({
  ...device,
  label: DEVICE_CATALOGS[device.kind](device.type).label,
});

export function graphDevices(target: GraphTarget, project: ProjectStore): ChainDevice[] {
  if (target.kind === "graph") return [named({ kind: target.device, type: target.type })];
  if (target.kind === "patch") return target.chain.map(named);
  const track = project.getTrack(target.trackId);
  return track?.kind === "instrument" ? soundChain(track).map(named) : [];
}
