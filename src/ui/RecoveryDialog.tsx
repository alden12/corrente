/**
 * The project-recovery dialog (DAW-38). Raised when a project's saved state cannot be read: its
 * keyframe is missing or is not a project, or the log would not replay onto it.
 *
 * It offers the rebuild rather than performing it silently, because the user is the one who knows
 * whether this project is worth waiting on - and then it shows a progress indicator rather than a
 * warning, because the measured answer is seconds (DAW-39 put 100k edits at ~129ms on a laptop).
 * A rebuild is the expected way forward, so it is the one primary button; a new project and the
 * other projects in the library are always there beside it (DAW-68), so no failure - of the rebuild,
 * or of the new project itself - leaves someone with nothing to press.
 *
 * Modal with no dismiss, like `ConflictDialog`: there is nothing useful behind it, and closing it
 * would leave a live project the app is deliberately not saving.
 */
import { useState } from "react";
import type { ProjectMeta } from "../audio/projects/library";

/** What the dialog is doing, which is also what it is offering. */
type Stage = "offer" | "rebuilding" | "failed" | "forking";

const BODY: Record<Stage, string> = {
  offer:
    "This project's saved state could not be read. Its edit history is still here, and replaying it reconstructs the project - usually in a second or two. Nothing is written until you choose.",
  rebuilding: "Replaying the edit history…",
  failed:
    "The history here does not reach far enough back to reconstruct this project. You can start a new project instead - this one is left exactly as it is and stays in your library, so nothing is thrown away.",
  forking: "Setting up the new project…",
};

export function RecoveryDialog({
  detail,
  onRebuild,
  onFork,
  others,
  onOpen,
}: {
  /** One clause saying which part failed, from `UnreadableProjectError`. */
  detail: string;
  /** Rebuild from the log. Resolves false when nothing here can rebuild it. */
  onRebuild: () => Promise<boolean>;
  /** Start a new project beside this one, leaving the damaged bundle alone. */
  onFork: () => Promise<void>;
  /** The rest of the library, any of which can be opened instead. */
  others: ProjectMeta[];
  onOpen: (project: ProjectMeta) => void;
}): React.ReactElement {
  const [stage, setStage] = useState<Stage>("offer");
  // Why the new project could not be made, kept on screen for a bug report.
  const [forkError, setForkError] = useState<string | null>(null);
  const busy = stage === "rebuilding" || stage === "forking";

  const rebuild = () => {
    setStage("rebuilding");
    void onRebuild().then(
      (recovered) => {
        // A success reloads into the healed bundle, so this stays on the progress indicator rather
        // than flashing a resolved state at someone for the frame before the page goes.
        if (!recovered) setStage("failed");
      },
      () => setStage("failed"),
    );
  };

  const fork = () => {
    // Back to where it was asked from on a failure: "failed" says the rebuild could not be done,
    // which is not what happened if the rebuild was never tried.
    const from = stage;
    setStage("forking");
    setForkError(null);
    void onFork().catch((error: unknown) => {
      setForkError(error instanceof Error ? error.message : String(error));
      setStage(from);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
    >
      <div className="bg-panel border border-line rounded-2xl p-7 max-w-lg mx-4 flex flex-col gap-4 shadow-2xl">
        <div className="flex flex-col gap-1.5">
          <h2 id="recovery-title" className="text-lg font-semibold text-strong">
            {stage === "failed" ? "This project cannot be rebuilt" : "This project needs rebuilding"}
          </h2>
          <p className="text-sm text-muted leading-relaxed">{BODY[stage]}</p>
        </div>

        <div className="rounded-lg border border-line bg-ground/50 px-3.5 py-3 font-mono text-[12px] text-faint break-words">
          {detail}
          {forkError && <p className="mt-1.5 text-hot">A new project could not be started: {forkError}</p>}
        </div>

        {others.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-faint">Or open another project</span>
            <ul className="max-h-40 overflow-y-auto flex flex-col rounded-lg border border-line divide-y divide-line">
              {others.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(project)}
                    disabled={busy}
                    className="w-full text-left px-3.5 py-2 text-sm text-ink truncate hover:bg-control cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  >
                    {project.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 mt-1">
          {busy && (
            <span
              className="w-4 h-4 mr-auto rounded-full border-2 border-faint border-t-transparent animate-spin"
              role="status"
              aria-label="Working"
            />
          )}
          {stage === "failed" || stage === "forking" ? (
            <button
              type="button"
              onClick={fork}
              disabled={busy}
              autoFocus
              className="font-mono text-[13px] font-semibold px-4 py-2 rounded-lg bg-you text-ground cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              Start a new project
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={fork}
                disabled={busy}
                className="font-mono text-[13px] font-semibold px-4 py-2 rounded-lg border border-line text-ink hover:border-faint cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                Start a new project
              </button>
              <button
                type="button"
                onClick={rebuild}
                disabled={busy}
                autoFocus
                className="font-mono text-[13px] font-semibold px-4 py-2 rounded-lg bg-you text-ground cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                Rebuild project state
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
