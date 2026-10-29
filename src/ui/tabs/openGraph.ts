/**
 * "View graph" from a menu anywhere (Explore's rows, a device in the rack, a track's tab): a request
 * the editor tabs hear and open as a tab of its own (INST-44, DAW-89): a device's graph, or a track's
 * or a patch's whole chain (INST-44.2). A channel rather than a prop, since the menus are far from the
 * tabs.
 */
import { useSyncExternalStore } from "react";
import { hasGraph, type DeviceKind } from "../../audio/definitions/chainGraph";
import type { Patch } from "../../audio/patches/library";
import { createListeners, createValueStore } from "../../listeners";
import type { TabTarget } from "./editorTabs";

type GraphTarget = Exclude<TabTarget, { kind: "track" }>;

const requests = createListeners<[GraphTarget]>();

/** Open the graph of the device `type` in a tab. */
export const openDeviceGraph = (device: DeviceKind, type: string): void =>
  requests.emit({ kind: "graph", device, type });

/** Open the track's whole chain in a tab. */
export const openChainGraph = (trackId: string): void => requests.emit({ kind: "chain", trackId });

/** Open a saved patch's whole chain in a tab: MIDI devices, instrument, effects. */
export const openPatchGraph = (patch: Patch): void =>
  requests.emit({
    kind: "patch",
    patchId: patch.id,
    name: patch.name,
    chain: [
      ...(patch.midiDevices ?? []).map((device) => ({
        kind: "midi" as const,
        type: device.type,
        bypassed: !!device.bypassed,
      })),
      { kind: "instrument" as const, type: patch.instrumentType },
      ...patch.effects.map((effect) => ({ kind: "effect" as const, type: effect.type, bypassed: !!effect.bypassed })),
    ],
  });

/** Hear the requests, as the editor tabs do; while something hears them, menus offer graphs. */
export const subscribeGraphRequests = (listener: (target: GraphTarget) => void): (() => void) => {
  const stop = requests.subscribe(listener);
  hosts.set(hosts.read() + 1);
  return () => {
    stop();
    hosts.set(hosts.read() - 1);
  };
};

/** How many editor tabs are there to open a graph in: none on a phone or in the plugin. */
const hosts = createValueStore(0);

/** Whether there are editor tabs to show a graph in: none on a phone or in the plugin. */
export const useCanOpenGraphs = (): boolean => useSyncExternalStore(hosts.subscribe, hosts.read) > 0;

/** Whether a device has a graph to show here: one on the engine, with tabs to show it in. */
export function useCanViewGraph(device: { kind: DeviceKind; type: string } | undefined): boolean {
  return useCanOpenGraphs() && device !== undefined && hasGraph(device.kind, device.type);
}
