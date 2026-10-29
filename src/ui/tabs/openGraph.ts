/**
 * "View device graph" from a menu anywhere (Explore's rows, a device in the rack, a track's tab): a
 * request the editor tabs hear and open as a tab of its own (INST-44, DAW-89). A channel rather than a
 * prop, since the menus are far from the tabs.
 */
import { useSyncExternalStore } from "react";
import { engineDevice } from "../../audio/definitions/engineDevices";
import { createListeners, createValueStore } from "../../listeners";
import type { TabTarget } from "./editorTabs";

type GraphTarget = Extract<TabTarget, { kind: "graph" }>;

const requests = createListeners<[GraphTarget]>();

/** Open the graph of the device `type` in a tab. */
export const openDeviceGraph = (device: GraphTarget["device"], type: string): void =>
  requests.emit({ kind: "graph", device, type });

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

/** Whether `type` has a graph to show here: a device on the engine, with tabs to show it in. */
export function useCanViewGraph(type: string | undefined): boolean {
  const open = useSyncExternalStore(hosts.subscribe, hosts.read) > 0;
  return open && type !== undefined && !!engineDevice(type);
}
