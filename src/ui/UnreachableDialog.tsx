/**
 * The project couldn't be reached (HOST-36): the server didn't answer, and this device's copy of the
 * project couldn't open it on its own. Nothing is damaged, so unlike `RecoveryDialog` there is nothing
 * to rebuild, only to try again: by hand, or by itself when the browser says it's back online. Or to open
 * another project, as from a damaged one, so the dialog is never a dead end (offline, the ones cached here).
 *
 * A reload is the retry, as after a rebuild: the boot chain runs again from the top, so a connection
 * that's back opens the project as ever. Modal with no dismiss, like `RecoveryDialog`: behind it is a
 * project the app isn't saving.
 */
import { useEffect } from "react";
import type { ProjectMeta } from "../audio/projects/library";
import { OtherProjects } from "./OtherProjects";

export function UnreachableDialog({
  onRetry,
  others,
  onOpen,
}: {
  onRetry: () => void;
  /** The rest of the library, any of which can be opened instead. */
  others: ProjectMeta[];
  onOpen: (project: ProjectMeta) => void;
}): React.ReactElement {
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unreachable-title"
    >
      <div className="bg-panel border border-line rounded-2xl p-7 max-w-lg mx-4 flex flex-col gap-4 shadow-2xl">
        <div className="flex flex-col gap-1.5">
          <h2 id="unreachable-title" className="text-lg font-semibold text-strong">
            Can't reach Corrente
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            This project couldn't be loaded because Corrente's server didn't answer. Your project is safe there, and
            nothing has been changed. Check your connection, then try again: it opens by itself once you're back online.
          </p>
        </div>
        <OtherProjects projects={others} onOpen={onOpen} />
        <div className="flex items-center justify-end mt-1">
          <button
            type="button"
            onClick={onRetry}
            autoFocus
            className="font-mono text-[13px] font-semibold px-4 py-2 rounded-lg bg-you text-ground cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
