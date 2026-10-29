/**
 * An inline-renameable label: shows text (truncating, with the full value on hover),
 * turns into an input on double-click, and commits on Enter / blur (Escape cancels).
 * The canonical editable-title component - shared by the timeline track/group headers,
 * the center workbench header, and the clip rail so renaming feels the same everywhere.
 * `className` carries the font/colour so the label and its input match their
 * surroundings; pointer events are stopped so editing never triggers the row's
 * select/drag. The hover title defaults to the full value plus a rename hint (so a
 * truncated name is readable on hover); pass `title` to override it.
 */
import { useState } from "react";

export function InlineRename({
  value,
  onCommit,
  className = "",
  title,
  startEditing = false,
  onDone,
}: {
  value: string;
  onCommit: (name: string) => void;
  className?: string;
  title?: string;
  /** Open as the input, for a rename started elsewhere (an editor tab's menu, DAW-89). */
  startEditing?: boolean;
  /** Called once the rename is committed or cancelled. */
  onDone?: () => void;
}) {
  const [editing, setEditingState] = useState(startEditing);
  const setEditing = (on: boolean) => {
    setEditingState(on);
    if (!on) onDone?.();
  };
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== value) onCommit(name);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`${className} px-1 py-0.5 rounded border border-you bg-ground outline-none`}
      />
    );
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      title={title ?? `${value} (double-click to rename)`}
      className={`${className} truncate cursor-text`}
    >
      {value}
    </span>
  );
}
