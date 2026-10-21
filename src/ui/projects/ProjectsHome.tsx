/**
 * The Projects page (MOBILE-19.3, approved board `ProjectsHome`, trimmed after trying it): the open
 * project as a large card, then all your projects as one list you can filter and switch between. The
 * phone's Projects tab and the desktop's Project view both open on it, and it is where every project
 * action lives: New (and on desktop Import) beside the filter, Rename, Export and Delete on each row.
 *
 * Thumbnails come from each project's summary (`summary.ts`), so the list never loads a project to
 * draw it. The open project's card reads the live store instead, so it is current as you edit.
 */
import { useRef, useState, useSyncExternalStore } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { EditLog } from "../../audio/commands/editLog";
import type { VersionStore } from "../../audio/commands/history";
import { useProject } from "../../audio/project/useProject";
import { currentProjectId, subscribeCurrentProject } from "../../audio/projectRepository";
import { listProjects, subscribeProjects, type ProjectMeta } from "../../audio/projects/library";
import {
  applyImport,
  createProject,
  deleteProject,
  planImport,
  renameProject,
  switchProject,
  type ImportPlan,
} from "../../audio/projects/operations";
import { reportUnreadableProject } from "../../audio/projects/recovery";
import { summarizeProject, type ProjectSummary } from "../../audio/projects/summary";
import { authEnabled } from "../../auth/session";
import { InlineRename } from "../InlineRename";
import { Menu, type MenuItem } from "../Menu";
import { downloadLibraryBackup, exportProjectFile, readProjectFile, restoreLibraryFile } from "../projectFile";
import { describeLibraryRestore } from "../../audio/library/backup";
import { NewerFileError } from "../../audio/projectRepository";
import { ImportDialog } from "./ImportDialog";
import { ExportIcon, ShareIcon } from "../shellIcons";
import { timeAgo, useNow } from "../timeAgo";
import { ArrangementThumb } from "./ArrangementThumb";
import { NewProjectDialog } from "./NewProjectDialog";
import { nameMatches } from "./nameMatches";
import { OnThisDeviceNote, onThisDevice } from "../hosting/OnThisDevice";

/** Two heads: a project someone else shared with you. */
function SharedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" className="w-4 h-4">
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M1.75 13c.4-2.3 2.1-3.6 4.25-3.6s3.85 1.3 4.25 3.6" />
      <path d="M10.5 3.6a2.2 2.2 0 0 1 0 4.1M12 9.6c1.2.4 2 1.6 2.25 3.4" />
    </svg>
  );
}

/** The "+ New" control, a button on touch and a menu (New, Import) on desktop. */
const NEW_BUTTON =
  "shrink-0 h-9 pointer-coarse:h-11 px-3.5 rounded-md bg-you/15 text-you text-[13px] pointer-coarse:text-[14px] font-medium cursor-pointer";

/** "Edited 5m ago · 118 BPM · 3/4 · 4 tracks": what a project is, in one line. */
function metaLine(modifiedAt: string, summary: ProjectSummary | null | undefined, now: number): string {
  const edited = modifiedAt ? `Edited ${timeAgo(Date.parse(modifiedAt), now)}` : null;
  if (!summary) return edited ?? "Not opened yet";
  const tracks = `${summary.trackCount} ${summary.trackCount === 1 ? "track" : "tracks"}`;
  const meter = `${summary.timeSignature.numerator}/${summary.timeSignature.denominator}`;
  return [edited, `${Math.round(summary.tempoBpm)} BPM`, meter, tracks].filter(Boolean).join(" · ");
}

export function ProjectsHome({
  projectStore,
  editLog,
  versionStore,
  onOpenProject,
  onOpenShare,
  showTitle = true,
  canImport = false,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
  /** Into the open project: its tracks and history. */
  onOpenProject: () => void;
  onOpenShare: (projectId: string, projectName: string) => void;
  /** The page's own "Projects" heading; off where a panel header already says it (desktop). */
  showTitle?: boolean;
  /** Offer "Import .daw.zip" under New: a desktop thing, where there are files to pick. */
  canImport?: boolean;
}) {
  const deps = { projectStore, editLog, versionStore };
  const project = useProject(projectStore);
  const projects = useSyncExternalStore(subscribeProjects, listProjects, listProjects);
  const openId = useSyncExternalStore(subscribeCurrentProject, currentProjectId, currentProjectId);
  const [filter, setFilter] = useState("");
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const now = useNow();

  const open = projects.find((meta) => meta.id === openId);
  // From the live store rather than the listing, which is seconds behind a session. `useProject`
  // re-renders this on every change to the project, so it is never stale; and it is a walk over the
  // tracks' placements, cheap beside the render it feeds.
  const openSummary = summarizeProject(projectStore.snapshot());
  const openName = project.name || open?.name || "Untitled";
  // Sharing is the owner's, and needs real accounts (see LibraryHeader).
  const canShare = authEnabled && open?.role !== "editor";
  // One list, newest first: yours and those shared with you together, each shared one marked. The
  // open project stays in it, marked too, so the list is always the whole picture. The box filters
  // by name; it is where ordering and a shared-only switch would go later.
  const listed = projects.filter((meta) => nameMatches(meta.id === openId ? openName : meta.name, filter));

  const rename = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // The edit renames it everywhere it is open (and on the server); the operation updates the list.
    editLog.dispatch({ type: "renameProject", name: trimmed });
    void renameProject(openId, trimmed);
  };
  const openRow = (meta: ProjectMeta) => {
    if (meta.id === openId) return onOpenProject();
    // Into the project's page once it has loaded, the same as tapping the open one.
    void switchProject(deps, meta.id)
      .then(onOpenProject)
      .catch((error: unknown) => {
        if (!reportUnreadableProject(error)) console.warn("[corrente] project switch failed:", error);
      });
  };
  const exportRow = (meta: ProjectMeta, name: string) => {
    setError(null);
    exportProjectFile(meta.id, name, deps).catch(() => setError(`Could not export “${name}”.`));
  };
  const [importing, setImporting] = useState<ImportPlan | null>(null);
  /** What the last library restore did, said once under the toolbar. */
  const [notice, setNotice] = useState<string | null>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const restoreLibraryFrom = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      setNotice(describeLibraryRestore(await restoreLibraryFile(file)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read that library backup.");
    }
  };
  const importFailed = (error: unknown) =>
    setError(error instanceof NewerFileError ? error.message : "Could not open that .daw.zip file.");
  /** Open a file: at once when it's a project not here (a restore, or a copy), else after asking (HOST-23.2.1.2). */
  const importFile = async (file: File) => {
    setError(null);
    try {
      const plan = await planImport(deps, await readProjectFile(file));
      if (plan.relation === "absent") await applyImport(deps, plan, plan.actions[0]);
      else setImporting(plan);
    } catch (error) {
      importFailed(error);
    }
  };
  const renamePrompt = (name: string) => {
    const next = window.prompt("Rename project", name);
    if (next) rename(next);
  };
  const remove = (meta: ProjectMeta) => {
    if (window.confirm(`Delete project "${meta.name}"? This cannot be undone.`)) void deleteProject(deps, meta.id);
  };
  const rowItems = (meta: ProjectMeta, name: string): MenuItem[] => [
    { label: "Open", onClick: () => openRow(meta) },
    // Renaming another project needs a rename route on the server (MOBILE-19.3 part 2); the open one
    // renames through its own edit, like the card's title.
    ...(meta.id === openId ? [{ label: "Rename…", onClick: () => renamePrompt(name) }] : []),
    { label: "Export…", onClick: () => exportRow(meta, name) },
    // Only an owner may delete (a shared project is someone else's), and never the last one.
    ...(meta.role === "editor" || projects.length <= 1
      ? []
      : [{ label: "Delete", danger: true, onClick: () => remove(meta) }]),
  ];

  return (
    // A container, so rows fit the panel they are in: the desktop's library column is far narrower
    // than a phone.
    <div className="@container flex-1 min-h-0 overflow-y-auto bg-panel pb-4">
      {showTitle ? (
        <h1 className="px-4 pt-4 pb-3 text-[22px] font-semibold text-strong">Projects</h1>
      ) : (
        <div className="h-3" />
      )}
      {onThisDevice && (
        <OnThisDeviceNote
          backup={{ onBackUp: downloadLibraryBackup, onRestore: () => libraryInput.current?.click() }}
        />
      )}

      <section aria-label="Open project" className="mx-4 rounded-xl border border-line bg-stage overflow-hidden">
        <button
          type="button"
          onClick={onOpenProject}
          aria-label={`Open ${openName}`}
          className="block w-full cursor-pointer"
        >
          <ArrangementThumb summary={openSummary} width="100%" height={112} className="rounded-none" />
        </button>
        <div className="flex items-start gap-2 px-3.5 pt-3 pb-3.5">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10.5px] font-semibold tracking-widest text-you">OPEN NOW</div>
            <InlineRename
              value={openName}
              onCommit={rename}
              title="Double-click to rename"
              className="mt-0.5 text-[19px] font-semibold text-strong"
            />
            <div className="truncate text-[12px] text-muted">{metaLine(open?.modifiedAt ?? "", openSummary, now)}</div>
          </div>
          {canShare && (
            <button
              type="button"
              onClick={() => onOpenShare(openId, openName)}
              aria-label={`Share ${openName}`}
              className="shrink-0 w-11 h-11 grid place-items-center rounded-lg border border-line text-ink cursor-pointer"
            >
              <ShareIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => open && exportRow(open, openName)}
            aria-label={`Export ${openName}`}
            title="Export a copy (.daw.zip)"
            className="shrink-0 w-11 h-11 grid place-items-center rounded-lg border border-line text-ink cursor-pointer"
          >
            <ExportIcon />
          </button>
        </div>
      </section>

      <div className="flex items-center gap-2 mx-4 mt-5 mb-1.5">
        <label className="flex-1 min-w-0 flex items-center gap-2 h-9 pointer-coarse:h-11 px-2.5 rounded-md border border-line bg-ground text-faint focus-within:border-you">
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
            placeholder="Filter projects"
            aria-label="Filter projects"
            className="flex-1 min-w-0 bg-transparent text-ink text-[12.5px] pointer-coarse:text-[15px] placeholder:text-faint outline-none"
          />
        </label>
        {canImport ? (
          <Menu
            label="New"
            align="right"
            trigger="+ New"
            triggerClassName={NEW_BUTTON}
            items={[
              { label: "New project…", onClick: () => setNaming(true) },
              { label: "Import .daw.zip…", onClick: () => importInput.current?.click() },
            ]}
          />
        ) : (
          <button type="button" onClick={() => setNaming(true)} className={NEW_BUTTON}>
            + New
          </button>
        )}
      </div>
      {error && <p className="px-4 py-1 text-[12px] text-hot">{error}</p>}
      {notice && (
        <p role="status" className="px-4 py-1 text-[12px] text-muted">
          {notice}
        </p>
      )}

      {listed.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-faint">{`No projects match “${filter.trim()}”.`}</p>
      ) : (
        <ul aria-label="Projects">
          {listed.map((meta) => {
            const isOpen = meta.id === openId;
            // The open row shows the live summary and name, like the card above it.
            const summary = isOpen ? openSummary : meta.summary;
            const name = isOpen ? openName : meta.name;
            return (
              <li
                key={meta.id}
                className="grid grid-cols-[minmax(0,1fr)_44px] items-center pl-3 @[18rem]:pl-4 pr-1 min-h-15"
              >
                <button
                  type="button"
                  onClick={() => openRow(meta)}
                  aria-label={`Open ${name}`}
                  aria-current={isOpen ? "true" : undefined}
                  className="flex items-center gap-3 min-w-0 py-2 text-left cursor-pointer"
                >
                  <span className="shrink-0 w-12 @[18rem]:w-19">
                    <ArrangementThumb summary={summary} width="100%" height={40} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className={`truncate text-[15px] font-medium ${isOpen ? "text-you" : "text-strong"}`}>
                        {name}
                      </span>
                      {meta.role === "editor" && (
                        <span
                          className="shrink-0 text-muted"
                          title="Shared with you"
                          aria-label="Shared with you"
                          role="img"
                        >
                          <SharedIcon />
                        </span>
                      )}
                      {isOpen && (
                        <span className="hidden @[18rem]:inline shrink-0 px-1 rounded-sm bg-you/15 font-mono text-[9px] tracking-wider text-you">
                          OPEN
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[12px] text-muted">
                      {metaLine(meta.modifiedAt, summary, now)}
                    </span>
                  </span>
                </button>
                <Menu
                  label={`Options for ${name}`}
                  align="right"
                  triggerClassName="w-11 h-11 grid place-items-center rounded-lg text-[18px] text-muted cursor-pointer"
                  items={rowItems(meta, name)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <input
        ref={importInput}
        type="file"
        accept=".zip,application/zip"
        aria-label="Import project file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
          event.target.value = "";
        }}
      />
      <input
        ref={libraryInput}
        type="file"
        accept=".json,application/json"
        aria-label="Restore library file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void restoreLibraryFrom(file);
          event.target.value = "";
        }}
      />
      {importing && importing.relation !== "absent" && (
        <ImportDialog
          plan={{ ...importing, relation: importing.relation }}
          onCancel={() => setImporting(null)}
          onChoose={(action) => {
            setImporting(null);
            applyImport(deps, importing, action).catch(importFailed);
          }}
        />
      )}
      {naming && (
        <NewProjectDialog
          onCancel={() => setNaming(false)}
          onCreate={(name) => {
            setNaming(false);
            void createProject(deps, name);
          }}
        />
      )}
    </div>
  );
}
