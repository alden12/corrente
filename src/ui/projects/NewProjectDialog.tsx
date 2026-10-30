import { useState } from "react";

/**
 * Name a new project before it is made (MOBILE-19.3): "+ New" used to create one called Untitled at
 * once, which filled the list with Untitleds and made a mistap cost a delete. A blank name takes the
 * `suggested` one ("Project 3", `nextProjectName`), so naming is offered, not required.
 */
export function NewProjectDialog({
  suggested,
  onCreate,
  onCancel,
}: {
  suggested: string;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <form
        className="w-full max-w-sm mx-4 flex flex-col gap-4 p-6 rounded-2xl border border-line bg-panel shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(name.trim() || suggested);
        }}
      >
        <h2 id="new-project-title" className="text-lg font-semibold text-strong">
          New project
        </h2>
        <label className="flex flex-col gap-1.5 text-[12px] text-muted">
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={suggested}
            className="h-11 px-3 rounded-lg border border-line bg-ground text-[15px] text-ink placeholder:text-faint outline-none focus:border-you"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-line text-[14px] text-ink cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-10 px-4 rounded-lg bg-you text-ground text-[14px] font-semibold cursor-pointer"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
