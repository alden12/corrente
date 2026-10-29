/**
 * The editor tabs (editorTabs.ts, DAW-89) for the open project, remembered on this device as the
 * selection is (`rememberedSelection.ts`): which tabs you have open is yours, not the project's.
 *
 * The tabs follow the selection: selecting a track anywhere (the timeline, the agent) shows it in its
 * tab or the preview. Opening a tab selects its track, so the rest of the app follows the tabs too.
 * A deleted track's tab closes.
 */
import { useEffect, useState } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import { readPersistent, writePersistent } from "../persistentStore";
import {
  closeOtherTabs,
  closeTab,
  keepActive,
  keepTab,
  parseTabs,
  retainTabs,
  showTab,
  tabKey,
  type EditorTabs,
  type TabTarget,
} from "./editorTabs";

const keyFor = (projectId: string) => `corrente:editor-tabs:${projectId}`;

export interface EditorTabsView {
  state: EditorTabs;
  /** Show a tab: select its track. */
  open: (target: TabTarget) => void;
  close: (key: string) => void;
  /** Close every tab but this one, and show it. */
  closeOthers: (key: string) => void;
  keep: (key: string) => void;
  /** Keep the tab shown, as an edit in it does. */
  keepShown: () => void;
}

/** `projectId` is the project `store` holds; the caller remounts this for another project. */
export function useEditorTabs(
  projectId: string | null,
  store: ProjectStore,
  selectedTrackId: string | null,
): EditorTabsView {
  const [state, setState] = useState<EditorTabs>(() => parseTabs(projectId ? readPersistent(keyFor(projectId)) : null));
  const trackIds = store
    .getTracks()
    .map((track) => track.id)
    .join(",");

  // Follow the selection, and drop tabs of tracks that are gone: worked out as the render sees a new
  // selection or track list, as React's "adjusting state when a prop changes" does, not in an effect.
  const [seen, setSeen] = useState<{ selectedTrackId: string | null; trackIds: string } | null>(null);
  if (seen?.selectedTrackId !== selectedTrackId || seen.trackIds !== trackIds) {
    setSeen({ selectedTrackId, trackIds });
    // Not while the project has no tracks: one still loading would lose every tab.
    setState((current) => {
      const live = trackIds ? retainTabs(current, (target) => !!store.getTrack(target.trackId)) : current;
      return selectedTrackId ? showTab(live, { kind: "track", trackId: selectedTrackId }) : live;
    });
  }

  useEffect(() => {
    if (projectId) writePersistent(keyFor(projectId), JSON.stringify(state));
  }, [projectId, state]);

  const select = (target: TabTarget) => store.selectTrack(target.trackId);
  return {
    state,
    open: select,
    close: (key) => {
      const next = closeTab(state, key);
      setState(next);
      const shown = next.tabs.find((tab) => tabKey(tab.target) === next.active);
      if (next.active !== state.active && shown) select(shown.target);
    },
    closeOthers: (key) => {
      const next = closeOtherTabs(state, key);
      setState(next);
      const shown = next.tabs[0];
      if (shown) select(shown.target);
    },
    keep: (key) => setState((current) => keepTab(current, key)),
    keepShown: () => setState(keepActive),
  };
}
