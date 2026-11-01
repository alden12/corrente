/**
 * Inside a project (MOBILE-19.3, approved board `ProjectOverview`): its name with Share, chips for
 * tempo, meter and length, then its tracks as a file tree (`ProjectTree`, DAW-83). The phone's Projects tab
 * and the desktop's Project view both show it one level in from `ProjectsHome`. The phone adds a
 * **History** tab beside the tracks; the desktop has history on its rail (Activity), so it has none.
 *
 * The chips open the Timing settings, where tempo and meter are set. A key chip joins them once
 * projects have a key, and collaborator faces once the listing carries members. History is the
 * Activity feed for now; part 3 replaces it with the designed timeline.
 */
import { HostedOnlyButton } from "../hosting/HostedOnly";
import { onThisDevice } from "../hosting/OnThisDevice";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { EditLog } from "../../audio/commands/editLog";
import type { Dispatch } from "../../audio/commands/types";
import { useProject } from "../../audio/project/useProject";
import { currentProjectId, subscribeCurrentProject } from "../../audio/projectRepository";
import { listProjects, subscribeProjects } from "../../audio/projects/library";
import { renameProject } from "../../audio/projects/operations";
import { summarizeProject } from "../../audio/projects/summary";
import { authEnabled } from "../../auth/session";
import { InlineRename } from "../InlineRename";
import { exportProjectFile } from "../projectFile";
import { exportMixdown } from "../mixdown";
import { Menu } from "../Menu";
import { usePersistentString } from "../usePersistent";
import { ProjectTree } from "./ProjectTree";
import { LoopButton, MetronomeButton } from "../TransportToggles";
import { formatLength } from "./overviewData";

const TABS = ["tracks", "history"] as const;
type ProjectTab = (typeof TABS)[number];
const TAB_LABEL: Record<ProjectTab, string> = { tracks: "Tracks", history: "History" };

const shareClass = "shrink-0 h-9 px-3 rounded-lg border border-line text-[13px] cursor-pointer hover:border-you";

export function ProjectOverview({
  projectStore,
  editLog,
  dispatch,
  history,
  onOpenShare,
  onOpenTiming,
  onOpenTrack,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  dispatch: Dispatch;
  /** A History tab's content, beside Tracks. Omitted, there are no tabs: just the tracks. */
  history?: ReactNode;
  onOpenShare: (projectId: string, projectName: string) => void;
  onOpenTiming: () => void;
  onOpenTrack?: () => void;
}) {
  const project = useProject(projectStore);
  const projects = useSyncExternalStore(subscribeProjects, listProjects, listProjects);
  const openId = useSyncExternalStore(subscribeCurrentProject, currentProjectId, currentProjectId);
  const [tab, setTab] = usePersistentString<ProjectTab>("corrente:project-tab", "tracks", TABS);
  const listed = projects.find((meta) => meta.id === openId);
  const name = project.name || listed?.name || "Untitled";
  // Sharing is the owner's, and needs real accounts (see ProjectsHome).
  const canShare = authEnabled && listed?.role !== "editor";
  const spanBeats = summarizeProject(projectStore.snapshot()).spanBeats;
  const meter = `${project.timeSignature.numerator}/${project.timeSignature.denominator}`;
  const chips = [
    { label: `${Math.round(project.tempoBpm)} BPM`, title: "Tempo" },
    { label: meter, title: "Time signature" },
    ...(spanBeats > 0 ? [{ label: formatLength(spanBeats, project.tempoBpm), title: "Length" }] : []),
  ];

  // What the last export has to say: under way, how it went, or that it failed.
  const [exportNote, setExportNote] = useState<{ text: string; failed?: boolean } | null>(null);
  const exportProject = () => {
    setExportNote(null);
    exportProjectFile(openId, name, { projectStore, editLog }).catch(() =>
      setExportNote({ text: `Could not export “${name}”.`, failed: true }),
    );
  };
  const exportMix = () => {
    setExportNote({ text: "Rendering the loop region…" });
    exportMixdown(projectStore, name).then(
      ({ omitted, clipped }) =>
        setExportNote(
          omitted.length > 0 || clipped
            ? {
                text: [
                  ...(clipped ? ["The mix clips in places: turn something down for a cleaner file."] : []),
                  ...omitted.map((line) => `Not in the mix: ${line}.`),
                ].join(" "),
              }
            : null,
        ),
      () => setExportNote({ text: "Could not render the mix.", failed: true }),
    );
  };

  const rename = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    // The edit renames it everywhere it is open (and on the server); the operation updates the list.
    editLog.dispatch({ type: "renameProject", name: trimmed });
    void renameProject(openId, trimmed);
  };

  return (
    // The phone scrolls the whole page; the desktop keeps the header put and scrolls the tree under it.
    <div className={history ? "flex-1 min-h-0 overflow-y-auto pb-4" : "flex-1 min-h-0 flex flex-col"}>
      <header className="shrink-0">
        <div className="flex items-center gap-2 px-4">
          <InlineRename
            value={name}
            onCommit={rename}
            title="Double-click to rename"
            className="flex-1 min-w-0 text-[22px] font-semibold text-strong"
          />
          {canShare && (
            <button type="button" onClick={() => onOpenShare(openId, name)} className={`${shareClass} text-ink`}>
              Share
            </button>
          )}
          {/* Shown on a standalone run too, saying what it needs (HOST-23.2.7). */}
          {onThisDevice && (
            <HostedOnlyButton feature="Sharing" className={shareClass}>
              Share
            </HostedOnlyButton>
          )}
          {/* The mix as a WAV (DAW-13), or a copy of the whole project as a .daw.zip: the way to keep one
              when it's only in this browser. */}
          <Menu
            label="Export"
            trigger="Export ▾"
            triggerClassName="shrink-0 h-9 px-3 rounded-lg border border-line text-[13px] text-ink cursor-pointer hover:border-you"
            items={[
              { label: "Mix of the loop region (WAV)", onClick: exportMix },
              { label: "Project file (.daw.zip)", onClick: exportProject },
            ]}
          />
        </div>
        {exportNote && (
          <p role="status" className={`px-4 pt-1 text-[12px] ${exportNote.failed ? "text-hot" : "text-muted"}`}>
            {exportNote.text}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {chips.map((chip) => (
            <button
              key={chip.title}
              type="button"
              onClick={onOpenTiming}
              title={`${chip.title}: open Timing settings`}
              className="h-8 px-2.5 rounded-md border border-line bg-stage font-mono text-[12px] text-ink whitespace-nowrap cursor-pointer hover:border-you"
            >
              {chip.label}
            </button>
          ))}
          {/* The transport's switches, here too so a phone reaches them (DAW-78). */}
          <div className="ml-auto flex items-center gap-1">
            <LoopButton />
            <MetronomeButton />
          </div>
        </div>
      </header>

      {history ? (
        <div role="tablist" aria-label="Project" className="flex gap-0.5 mx-4 mt-4 mb-3 p-0.5 rounded-lg bg-stage">
          {TABS.map((each) => (
            <button
              key={each}
              type="button"
              role="tab"
              aria-selected={tab === each}
              onClick={() => setTab(each)}
              className={`flex-1 h-8 pointer-coarse:h-9 rounded-md text-[13px] cursor-pointer ${
                tab === each ? "bg-control text-strong" : "text-muted hover:text-ink"
              }`}
            >
              {TAB_LABEL[each]}
            </button>
          ))}
        </div>
      ) : (
        <div className="h-4 shrink-0" />
      )}

      {history && tab === "history" ? (
        history
      ) : (
        <ProjectTree projectStore={projectStore} dispatch={dispatch} onOpenTrack={onOpenTrack} scrolls={!history} />
      )}
    </div>
  );
}
