/**
 * The project page's tracks as a file tree (DAW-83, canvas "Corrente Project Tree", version B): groups
 * nested to any depth, then their tracks, one short row each with the track's clips across the song
 * (`ProjectTreeRow`). It replaced the group cards, which gave every level of nesting a box of its own.
 *
 * Choosing a track selects it (`onOpenTrack` then takes the phone to the Studio). A group's fold is
 * the arrangement's too, one value remembered on this device (`groupFolds.ts`, DAW-49). The toolbar
 * adds tracks and groups, filters by name and folds or opens every group at once.
 */
import { useState } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { useProject } from "../../audio/project/useProject";
import { beatsPerBar } from "../../audio/project/schema";
import { summarizeProject } from "../../audio/projects/summary";
import { arrangementAddItems } from "../arrangement/addItems";
import { Menu } from "../Menu";
import { treeRows } from "./overviewData";
import { ProjectTreeRow, type TreeContext } from "./ProjectTreeRow";

/** Bar numbers over the strips, a quarter of the song apart: `1 5 9 13` for sixteen bars. */
function rulerBars(spanBeats: number, barBeats: number): { bar: number; left: number }[] {
  const bars = spanBeats / Math.max(barBeats, 1e-9);
  const marks = [0, 0.25, 0.5, 0.75].map((fraction) => Math.round(fraction * bars));
  return [...new Set(marks)].map((bar) => ({ bar: bar + 1, left: (bar / Math.max(bars, 1)) * 100 }));
}

const toolClass =
  "w-6.5 h-6.5 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-[5px] text-muted hover:text-ink hover:bg-control cursor-pointer";

export function ProjectTree({
  projectStore,
  dispatch,
  onOpenTrack,
  scrolls = false,
}: {
  projectStore: ProjectStore;
  dispatch: Dispatch;
  /** After a track is chosen: the phone goes to the Studio; the desktop already shows it. */
  onOpenTrack?: () => void;
  /** Fill the space left and scroll its rows there, the toolbar and ruler staying put (the desktop). */
  scrolls?: boolean;
}) {
  const project = useProject(projectStore);
  const [filter, setFilter] = useState("");
  const [filterShown, setFilterShown] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const spanBeats = summarizeProject(projectStore.snapshot()).spanBeats;
  const rows = treeRows(project.groups, project.tracks, filter, spanBeats);
  const filtering = filter.trim() !== "";
  const anyOpen = project.groups.some((group) => !group.collapsed);

  const context: TreeContext = {
    projectStore,
    dispatch,
    groups: project.groups,
    selectedId: project.selectedTrackId,
    activeGroupId: project.tracks.find((track) => track.id === project.selectedTrackId)?.parentId ?? null,
    renamingId,
    setRenamingId,
    swipedId,
    setSwipedId,
    onChoose: (track) => {
      projectStore.selectTrack(track.id);
      onOpenTrack?.();
    },
  };

  return (
    // The indent widens on a phone, where a row is a finger's height too.
    <div
      className={`flex flex-col [--tree-indent:14px] pointer-coarse:[--tree-indent:16px] ${scrolls ? "flex-1 min-h-0" : ""}`}
    >
      <div className="shrink-0 flex items-center gap-0.5 h-8 pointer-coarse:h-12 pl-4 pr-1.5">
        <span className="flex-1 font-mono text-[10px] tracking-[0.14em] text-muted">TRACKS</span>
        <Menu
          label="Add a track or group"
          align="right"
          items={() => arrangementAddItems(project.groups, dispatch)}
          trigger={
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className="w-4 h-4"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
          }
          triggerClassName={toolClass}
        />
        <button
          type="button"
          aria-label="Filter tracks by name"
          aria-pressed={filterShown || filtering}
          onClick={() => setFilterShown(!filterShown || filtering)}
          className={toolClass}
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-4 h-4"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={anyOpen ? "Fold every group" : "Open every group"}
          onClick={() => project.groups.forEach((group) => projectStore.setGroupCollapsed(group.id, anyOpen))}
          className={toolClass}
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-4 h-4"
          >
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
            <path d={anyOpen ? "M5.5 8h5" : "M5.5 8h5M8 5.5v5"} />
          </svg>
        </button>
      </div>

      {(filterShown || filtering) && (
        <div className="shrink-0 px-3 pb-1.5">
          <input
            type="search"
            autoFocus={!filtering}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter tracks"
            aria-label="Filter tracks"
            className="w-full h-7.5 pointer-coarse:h-11 px-2.5 rounded-md border border-line bg-ground text-ink text-[12.5px] pointer-coarse:text-[15px] placeholder:text-faint outline-none focus:border-you"
          />
        </div>
      )}

      {spanBeats > 0 && (
        <div
          aria-hidden="true"
          className="shrink-0 grid grid-cols-[minmax(0,1fr)_84px_64px] pointer-coarse:grid-cols-[minmax(0,1fr)_72px_28px_40px] gap-2 pr-2 pointer-coarse:pr-0 pb-1 font-mono text-[9px] text-faint"
        >
          <span />
          <span className="relative h-3">
            {rulerBars(spanBeats, beatsPerBar(project.timeSignature)).map((mark) => (
              <span key={mark.bar} className="absolute" style={{ left: `${mark.left}%` }}>
                {mark.bar}
              </span>
            ))}
          </span>
        </div>
      )}

      {filtering && rows.length === 0 && (
        <p className="shrink-0 px-4 py-2 text-[12.5px] text-faint">{`No tracks match “${filter.trim()}”.`}</p>
      )}
      <ul aria-label="Tracks" className={scrolls ? "flex-1 min-h-0 overflow-y-auto pb-4" : ""}>
        {rows.map((row) => (
          <ProjectTreeRow
            key={row.kind === "group" ? `group:${row.group.id}` : `track:${row.track.id}`}
            row={row}
            context={context}
          />
        ))}
      </ul>
    </div>
  );
}
