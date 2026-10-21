import type { ImportAction, ImportPlan } from "../../audio/projects/operations";
import type { ImportRelation } from "../../audio/projects/projectVersions";

/**
 * What to do with an opened file that's a version of a project here (HOST-23.2.1.2). A file that
 * isn't (a restore) or that only can be copied without a question doesn't come here.
 */
const COPY: Record<Exclude<ImportRelation, "absent">, (name: string) => { title: string; body: string }> = {
  same: (name) => ({ title: `You already have this version of “${name}”`, body: "Nothing in the file is new." }),
  earlier: (name) => ({
    title: `An earlier version of “${name}”`,
    body: "Your project has changed since this file was saved. Roll back to it (you can undo that), or open it as a separate project.",
  }),
  newer: (name) => ({
    title: `A newer version of “${name}”`,
    body: "This file has changes your project doesn't. Bring your project up to date with it, or open it as a separate project.",
  }),
  diverged: (name) => ({
    title: `“${name}” has changed in both places`,
    body: `This file and your project each have changes the other doesn't, and they can't be combined. It opens as a separate project, “${name} (copy)”.`,
  }),
};

const LABEL: Record<ImportAction, string> = {
  restore: "Restore",
  open: "Open it",
  rollback: "Roll back",
  update: "Update",
  copy: "Open as a new project",
};

export function ImportDialog({
  plan,
  onChoose,
  onCancel,
}: {
  plan: ImportPlan & { relation: Exclude<ImportRelation, "absent"> };
  onChoose: (action: ImportAction) => void;
  onCancel: () => void;
}) {
  const { title, body } = COPY[plan.relation](plan.name);
  // The suggested choice last, where a dialog's main button sits.
  const choices = [...plan.actions].reverse();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-md mx-4 flex flex-col gap-4 p-6 rounded-2xl border border-line bg-panel shadow-2xl">
        <h2 id="import-title" className="text-lg font-semibold text-strong text-balance">
          {title}
        </h2>
        <p className="text-[14px] leading-snug text-ink">{body}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-line text-[14px] text-ink cursor-pointer"
          >
            Cancel
          </button>
          {choices.map((action, index) => (
            <button
              key={action}
              type="button"
              autoFocus={index === choices.length - 1}
              onClick={() => onChoose(action)}
              className={
                index === choices.length - 1
                  ? "h-10 px-4 rounded-lg bg-you text-ground text-[14px] font-semibold cursor-pointer"
                  : "h-10 px-4 rounded-lg border border-line text-[14px] text-ink cursor-pointer"
              }
            >
              {LABEL[action]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
