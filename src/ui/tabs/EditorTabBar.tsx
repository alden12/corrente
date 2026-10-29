/**
 * The editor tabs' bar over the workbench (DAW-89): each tab wears its instrument's portrait and the
 * track's name, in italics while it's the preview. Clicking a tab opens it; double-clicking keeps it;
 * × closes it; right-clicking offers renaming the track and closing tabs. The mouse wheel scrolls the
 * bar sideways.
 */
import { useState, type WheelEvent } from "react";
import type { Dispatch } from "../../audio/commands/types";
import { EMPTY_INSTRUMENT, instrumentInfos } from "../../audio/instruments/catalog";
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import { ExploreThumb } from "../explore/ExploreThumb";
import { instrumentArt } from "../explore/exploreItems";
import { InlineRename } from "../InlineRename";
import { useContextMenu } from "../useContextMenu";
import { tabKey, type Tab } from "./editorTabs";
import type { EditorTabsView } from "./useEditorTabs";

/** A thumb's size in the bar, in px. */
const THUMB = 20;

/** What a track plays, in words: for the portrait's tooltip, since the tab no longer spells it out. */
const kindOf = (track: Track): string =>
  track.kind === "audio"
    ? "Audio"
    : track.instrumentType === EMPTY_INSTRUMENT
      ? "Empty"
      : (instrumentInfos().find((info) => info.type === track.instrumentType)?.label ?? track.instrumentType);

/** The track's instrument portrait; audio a waveform, an empty track the instrument glyph. */
function TrackThumb({ track, projectStore }: { track: Track; projectStore: ProjectStore }) {
  if (track.kind === "audio" || track.instrumentType === EMPTY_INSTRUMENT) {
    return <ExploreThumb category={track.kind === "audio" ? "samples" : "instruments"} seed={track.id} size={THUMB} />;
  }
  return (
    <ExploreThumb
      category="instruments"
      size={THUMB}
      badge={false}
      {...instrumentArt(track.instrumentType, projectStore)}
    />
  );
}

/** The wheel turned over the bar scrolls it sideways; a trackpad's sideways swipe already does. */
const scrollSideways = (event: WheelEvent<HTMLDivElement>) => {
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
};

export function EditorTabBar({
  tabs,
  projectStore,
  dispatch,
}: {
  tabs: EditorTabsView;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  const { state } = tabs;
  // The last tab can't close: the workbench always shows the selected track.
  const closable = state.tabs.length > 1;
  return (
    <div
      className="flex items-stretch h-10 border-b border-line bg-frame shrink-0 overflow-x-auto [scrollbar-width:none]"
      role="tablist"
      aria-label="Open editors"
      onWheel={scrollSideways}
    >
      {state.tabs.map((tab) => (
        <EditorTab
          key={tabKey(tab.target)}
          tab={tab}
          active={tabKey(tab.target) === state.active}
          closable={closable}
          tabs={tabs}
          projectStore={projectStore}
          dispatch={dispatch}
        />
      ))}
    </div>
  );
}

function EditorTab({
  tab,
  active,
  closable,
  tabs,
  projectStore,
  dispatch,
}: {
  tab: Tab;
  active: boolean;
  closable: boolean;
  tabs: EditorTabsView;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  const [renaming, setRenaming] = useState(false);
  const { openAt, menu } = useContextMenu();
  const track = projectStore.getTrack(tab.target.trackId);
  if (!track) return null;
  const key = tabKey(tab.target);
  const nameClass = `text-[13px] truncate ${active ? "font-semibold text-strong" : "text-muted"} ${tab.preview ? "italic" : ""}`;
  return (
    // No fill on the active tab: the bar is its own surface (`frame`) and the teal underline is what
    // marks selection.
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={() => tabs.open(tab.target)}
      onDoubleClick={() => tabs.keep(key)}
      onContextMenu={(event) =>
        openAt(event, [
          {
            label: "Rename track",
            onClick: () => {
              tabs.keep(key);
              setRenaming(true);
            },
          },
          ...(tab.preview ? [{ label: "Keep tab open", onClick: () => tabs.keep(key) }] : []),
          ...(closable
            ? [
                { label: "Close tab", onClick: () => tabs.close(key) },
                { label: "Close other tabs", onClick: () => tabs.closeOthers(key) },
              ]
            : []),
        ])
      }
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") tabs.open(tab.target);
      }}
      className={`group relative flex items-center gap-2 h-full pl-3 pr-1.5 border-r border-line max-w-60 shrink-0 cursor-pointer select-none ${active ? "" : "hover:bg-panel/60"}`}
    >
      {active && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-you" />}
      <span title={kindOf(track)} className="flex shrink-0">
        <TrackThumb track={track} projectStore={projectStore} />
      </span>
      {renaming ? (
        <InlineRename
          value={track.name}
          onCommit={(name) => dispatch({ type: "setTrack", trackId: track.id, name })}
          startEditing
          onDone={() => setRenaming(false)}
          className={nameClass}
        />
      ) : (
        <span title={tab.preview ? `${track.name} (double-click to keep this tab)` : track.name} className={nameClass}>
          {track.name}
        </span>
      )}
      {closable ? (
        <button
          type="button"
          aria-label={`Close ${track.name}`}
          title="Close"
          onClick={(event) => {
            event.stopPropagation();
            tabs.close(key);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className={`w-6 h-6 shrink-0 flex items-center justify-center rounded text-[16px] leading-none text-faint hover:text-ink hover:bg-ground cursor-pointer ${active ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
        >
          ×
        </button>
      ) : (
        <span className="w-1.5 shrink-0" />
      )}
      {menu}
    </div>
  );
}
