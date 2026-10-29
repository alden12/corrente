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

export function LibraryHeader({ activeView, editLog }: { activeView: PanelView; editLog: EditLog }) {
  const { canUndo, canRedo } = useEditLog(editLog);
  return (
    <div className="shrink-0 flex items-center gap-1 h-10 pl-2.5 pr-1 border-b border-line">
      <span className="font-semibold text-[13px] text-strong">{VIEW_TITLE[activeView]}</span>
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
