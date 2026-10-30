/**
 * A graph on a phone or tablet (INST-44), where there are no editor tabs: the whole screen, over the
 * app, with a way back. It hears the same requests the tabs do (openGraph.ts), so every "View graph"
 * (the rack, the devices' menu, Explore) opens here, and its being mounted is what offers them.
 */
import { Suspense, useEffect, useState } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import { useProject } from "../../audio/project/useProject";
import { subscribeGraphRequests, type GraphTarget } from "../tabs/openGraph";
import { tabKey } from "../tabs/editorTabs";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from "../shell/safeArea";
import { graphDevices } from "./graphDevices";
import { LazyDeviceGraphView } from "./lazyGraphView";

/** What the page's bar names: a device, a track's chain, or a patch's. */
const TITLES: {
  [Kind in GraphTarget["kind"]]: (target: Extract<GraphTarget, { kind: Kind }>, project: ProjectStore) => string;
} = {
  graph: (target, project) => graphDevices(target, project)[0]?.label ?? target.type,
  chain: (target, project) => `${project.getTrack(target.trackId)?.name ?? "Track"}'s chain`,
  patch: (target) => `${target.name}'s chain`,
};

export function GraphPage({ projectStore }: { projectStore: ProjectStore }) {
  const [target, setTarget] = useState<GraphTarget | null>(null);
  useEffect(() => subscribeGraphRequests(setTarget), []);
  // Redrawn as the project changes, so a track's chain follows its devices.
  useProject(projectStore);
  if (!target) return null;
  const title = (TITLES[target.kind] as (target: GraphTarget, project: ProjectStore) => string)(target, projectStore);
  return (
    <div
      role="dialog"
      aria-label={`${title} graph`}
      className="fixed inset-0 z-50 flex flex-col bg-ground"
      style={{ paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM, paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT }}
    >
      <div className="shrink-0 flex items-center gap-1 h-12 pr-3 border-b border-line bg-panel">
        <button
          type="button"
          onClick={() => setTarget(null)}
          aria-label="Back"
          className="shrink-0 flex items-center gap-1 h-11 px-3 text-[14px] text-you cursor-pointer"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="w-4.5 h-4.5"
          >
            <path d="M10 3 5 8l5 5" />
          </svg>
          Back
        </button>
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-strong">{title}</p>
        <span className="shrink-0 font-mono text-[10px] text-faint">graph</span>
      </div>
      <Suspense
        fallback={<p className="flex-1 flex items-center justify-center text-sm text-muted">Drawing the graph…</p>}
      >
        <LazyDeviceGraphView key={tabKey(target)} devices={graphDevices(target, projectStore)} compact />
      </Suspense>
    </div>
  );
}
