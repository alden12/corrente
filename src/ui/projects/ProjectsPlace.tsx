import type { ReactNode } from "react";
import { usePersistentString } from "../usePersistent";
import { PROJECTS_PAGE_DEFAULT, PROJECTS_PAGE_KEY, PROJECTS_PAGES, type ProjectsPage } from "./projectsPage";

/**
 * Projects as a place with two pages (MOBILE-19.3): `home` (the list, `ProjectsHome`) and `inside`
 * (the open project's own views, passed as `inside`), with a way back up. Both shells use it, so
 * the phone and the desktop move between the two the same way.
 */
export function ProjectsPlace({ home, inside }: { home: (openProject: () => void) => ReactNode; inside: ReactNode }) {
  const [page, setPage] = usePersistentString<ProjectsPage>(PROJECTS_PAGE_KEY, PROJECTS_PAGE_DEFAULT, PROJECTS_PAGES);
  if (page === "home") return <>{home(() => setPage("inside"))}</>;
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <BackToProjects onBack={() => setPage("home")} />
      {inside}
    </div>
  );
}

/** Up from inside a project to the list of projects. */
export function BackToProjects({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to Projects"
      className="shrink-0 self-start flex items-center gap-1 h-11 px-3 text-[14px] text-you cursor-pointer"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="w-4.5 h-4.5"
      >
        <path d="M10 3 5 8l5 5" />
      </svg>
      Projects
    </button>
  );
}
