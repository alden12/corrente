/**
 * How an Explore item's graph opens (INST-44), where there's somewhere to show it: a device's own, or
 * a patch's whole chain (INST-44.2). Shared by a row's menu and the panel a tapped row opens.
 */
import { openDeviceGraph, openPatchGraph, useCanOpenGraphs, useCanViewGraph } from "../tabs/openGraph";
import type { ExploreItem } from "./exploreItems";

export interface ItemGraph {
  label: string;
  open: () => void;
}

export function useItemGraph(item: ExploreItem | undefined): ItemGraph | undefined {
  const source = item?.source;
  const device =
    source?.kind === "instrument" || source?.kind === "effect" || source?.kind === "midi" ? source : undefined;
  const deviceGraph = useCanViewGraph(device);
  const canOpen = useCanOpenGraphs();
  if (device && deviceGraph)
    return { label: "View device graph", open: () => openDeviceGraph(device.kind, device.type) };
  if (source?.kind === "patch" && canOpen)
    return { label: "View patch graph", open: () => openPatchGraph(source.patch) };
  return undefined;
}
