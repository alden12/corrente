/**
 * The rest of the library, as a way out of a project that won't open: damaged (`RecoveryDialog`,
 * DAW-68) or out of reach (`UnreachableDialog`, HOST-36). Nothing when there is nothing else to open.
 */
import type { ProjectMeta } from "../audio/projects/library";

export function OtherProjects({
  projects,
  onOpen,
  disabled = false,
}: {
  projects: ProjectMeta[];
  onOpen: (project: ProjectMeta) => void;
  disabled?: boolean;
}): React.ReactElement | null {
  if (projects.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-faint">Or open another project</span>
      <ul className="max-h-40 overflow-y-auto flex flex-col rounded-lg border border-line divide-y divide-line">
        {projects.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => onOpen(project)}
              disabled={disabled}
              className="w-full text-left px-3.5 py-2 text-sm text-ink truncate hover:bg-control cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              {project.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
