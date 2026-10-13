/**
 * The project page's track list (MOBILE-19.3, board "Chosen - Group cards with track rows inside"):
 * a filter box, then each group as a card (`GroupCard`) with its tracks inside, then "+ Group".
 * Choosing a track selects it (`onOpenTrack` then takes the phone to the Studio).
 *
 * Cards start closed; which are open is kept on this device (`openGroups.ts`), apart from the arrangement's
 * own group collapse. It replaced the library's project tree. Mute / solo / level go through the
 * edit log (undoable); selection is a direct store call.
 */
import { useState } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import type { TrackMeta } from "../../audio/project/types";
import { useProject } from "../../audio/project/useProject";
import { newGroupId } from "../../audio/commands/ids";
import { summarizeProject } from "../../audio/projects/summary";
import { GroupCard, TrackRow, type CardContext } from "./GroupCard";
import { groupTree } from "./overviewData";
import { useOpenGroups } from "./openGroups";

export function TrackList({
  projectStore,
  dispatch,
  onOpenTrack,
}: {
  projectStore: ProjectStore;
  dispatch: Dispatch;
  /** After a track is chosen: the phone goes to the Studio; the desktop already shows it. */
  onOpenTrack?: () => void;
}) {
  const project = useProject(projectStore);
  const [filter, setFilter] = useState("");
  const [opened, toggle] = useOpenGroups();
  const { nodes, orphans } = groupTree(project.groups, project.tracks, filter);
  const context: CardContext = {
    dispatch,
    selectedId: project.selectedTrackId,
    laneOf: (track: TrackMeta) => project.tracks.findIndex((candidate) => candidate.id === track.id),
    spanBeats: summarizeProject(projectStore.snapshot()).spanBeats,
    opened,
    onToggle: toggle,
    filtering: filter.trim() !== "",
    onChoose: (track) => {
      projectStore.selectTrack(track.id);
      onOpenTrack?.();
    },
  };

  return (
    // A container, so rows fit the panel: the desktop library column is far narrower than a phone.
    <div className="@container flex flex-col gap-2.5 px-3 pointer-coarse:px-4">
      <label className="flex items-center gap-2 h-9 pointer-coarse:h-11 px-2.5 rounded-md border border-line bg-ground text-faint focus-within:border-you">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          className="w-4 h-4 shrink-0"
        >
          <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
        </svg>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter tracks"
          aria-label="Filter tracks"
          className="flex-1 min-w-0 bg-transparent text-ink text-[12.5px] pointer-coarse:text-[15px] placeholder:text-faint outline-none"
        />
      </label>

      {context.filtering && nodes.length === 0 && orphans.length === 0 && (
        <p className="py-2 text-[12.5px] text-faint">{`No tracks match “${filter.trim()}”.`}</p>
      )}
      {nodes.map((node) => (
        <GroupCard key={node.group.id} node={node} context={context} />
      ))}
      {orphans.length > 0 && (
        <ul aria-label="Tracks without a group" className="rounded-xl border border-line bg-stage overflow-hidden">
          {orphans.map((track) => (
            <TrackRow key={track.id} track={track} context={context} />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => dispatch({ type: "createGroup", id: newGroupId() })}
        className="h-11 pointer-coarse:h-12 rounded-lg border border-dashed border-line text-[13px] text-muted hover:text-ink cursor-pointer"
      >
        + Group
      </button>
    </div>
  );
}
