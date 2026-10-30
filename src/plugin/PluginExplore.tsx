/**
 * Explore in the plugin's window (PLUGIN-3.5): the app's Explore, scoped to one track. Only what the
 * plugin plays is listed (instruments, patches, effects); a sound tried plays through the plugin
 * (`PluginPreview`), and taking one replaces the track's. Effects tapped wait in their panel to be
 * added, as in the app's library panel (`LibraryPanel`), which this follows.
 */
import { useEffect, useState } from "react";
import type { Dispatch } from "../audio/commands/types";
import type { SoundPreview } from "../audio/live/preview";
import type { ProjectStore } from "../audio/project/projectStore";
import { DevicePanel } from "../ui/explore/DevicePanel";
import { ExploreView } from "../ui/explore/ExploreView";
import { panelFor } from "../ui/explore/exploreActions";
import type { ExploreItem } from "../ui/explore/exploreItems";
import { ExploreScopeProvider, type ExploreScope } from "../ui/explore/exploreScope";
import { TryPanel } from "../ui/explore/TryPanel";
import { CollapseButton } from "../ui/LibraryHeader";

const PLUGIN_SCOPE: ExploreScope = { oneTrack: true, kinds: new Set(["instrument", "patch", "effect"]) };

export function PluginExplore({
  project,
  dispatch,
  preview,
  onCollapse,
}: {
  project: ProjectStore;
  dispatch: Dispatch;
  preview: SoundPreview;
  /** Fold the panel away to the rail, as the app's library panel does from its header. */
  onCollapse: () => void;
}) {
  // One panel at a time under the list: trying a sound closes an effect shown.
  const [shown, setShown] = useState<ExploreItem | null>(null);
  useEffect(
    () =>
      preview.subscribe(() => {
        if (preview.getState()) setShown(null);
      }),
    [preview],
  );
  // Nothing goes out of the way after a pick: the rack beside it shows what changed.
  const picked = (act: () => void) => act();

  return (
    <ExploreScopeProvider value={PLUGIN_SCOPE}>
      <div className="flex-1 min-w-0 bg-rail border-r border-line flex flex-col min-h-0">
        <div className="shrink-0 flex items-center gap-1 h-10 pl-2.5 pr-1 border-b border-line">
          <span className="font-semibold text-[13px] text-strong">Explore</span>
          <CollapseButton onCollapse={onCollapse} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ExploreView
            projectStore={project}
            dispatch={dispatch}
            onPicked={picked}
            preview={preview}
            shown={shown?.key}
            onShow={setShown}
          />
        </div>
        {shown && panelFor(shown) === "add" && (
          <DevicePanel
            item={shown}
            projectStore={project}
            dispatch={dispatch}
            onPicked={picked}
            onClose={() => setShown(null)}
            layout="desktop"
          />
        )}
        <TryPanel preview={preview} projectStore={project} dispatch={dispatch} onPicked={picked} />
      </div>
    </ExploreScopeProvider>
  );
}
