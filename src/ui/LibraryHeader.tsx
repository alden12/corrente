/**
 * The library panel's header: the active view's title on the left, undo and redo on the right.
 * The project actions that used to sit in a menu here moved to where projects are shown: New and
 * Import beside the Projects filter, Export and Delete on each row (`ProjectsHome`), and the open
 * project's name and Share at the top of its own page (`ProjectOverview`). The MCP status lives
 * at the foot of the activity rail (DAW-87), not here.
 */
import type { EditLog } from "../audio/commands/editLog";
import { useEditLog } from "../audio/commands/useEditLog";
import type { PanelView } from "./libraryViews";
import { IconButton } from "./controls/IconButton";
import { UndoIcon } from "./shellIcons";

const VIEW_TITLE: Record<PanelView, string> = {
  project: "Projects",
  explore: "Explore",
  activity: "Activity",
};

/**
 * Folds the side panel away to the rail, beside the title it belongs to. The rail's icons used to
 * do it when clicked again, which left no way back to a view's start (2026-10-30, Alden).
 */
export function CollapseButton({ onCollapse }: { onCollapse: () => void }) {
  return (
    <IconButton label="Collapse the panel" onClick={onCollapse}>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
      >
        <path d="M8 4 4 8l4 4M12 4 8 8l4 4" />
      </svg>
    </IconButton>
  );
}

export function LibraryHeader({
  activeView,
  editLog,
  onCollapse,
}: {
  activeView: PanelView;
  editLog: EditLog;
  /** Where the panel can fold away (the desktop); the phone's places can't. */
  onCollapse?: () => void;
}) {
  const { canUndo, canRedo } = useEditLog(editLog);
  return (
    <div className="shrink-0 flex items-center gap-1 h-10 pl-2.5 pr-1 border-b border-line">
      <span className="font-semibold text-[13px] text-strong">{VIEW_TITLE[activeView]}</span>
      {onCollapse && <CollapseButton onCollapse={onCollapse} />}
      {/* Undo and redo apply from any view, so they stay in the header whatever the panel shows. */}
      <IconButton label="Undo" onClick={() => editLog.undo()} disabled={!canUndo} className="ml-auto">
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo" onClick={() => editLog.redo()} disabled={!canRedo}>
        <UndoIcon flip />
      </IconButton>
    </div>
  );
}
