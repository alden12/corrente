import type { ReactNode } from "react";
import { usePersistentString } from "../usePersistent";
import { useFromExplore } from "../explore/fromExplore";
import { PROJECTS_PAGE_DEFAULT, PROJECTS_PAGE_KEY, PROJECTS_PAGES, type ProjectsPage } from "./projectsPage";

/**
 * Projects as a place with two pages (MOBILE-19.3): `home` (the list, `ProjectsHome`) and `inside`
 * (the open project's own views, passed as `inside`), with a way back up. Both shells use it, so
 * the phone and the desktop move between the two the same way.
 */
export function ProjectsPlace({
  home,
  inside,
  onBackToExplore,
}: {
  home: (openProject: () => void) => ReactNode;
  inside: ReactNode;
  /** Back to Explore, offered while Projects was reached from there (COMM-2). */
  onBackToExplore?: () => void;
}) {
  const [page, setPage] = usePersistentString<ProjectsPage>(PROJECTS_PAGE_KEY, PROJECTS_PAGE_DEFAULT, PROJECTS_PAGES);
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <BackLinks toProjects={page === "inside" ? () => setPage("home") : undefined} toExplore={onBackToExplore} />
      {page === "home" ? home(() => setPage("inside")) : inside}
    </div>
  );
}

/**
 * The ways back from a Projects page: up to the list from inside a project, and to Explore while
 * Projects was reached from there (`fromExplore`). Nothing when there is neither.
 */
export function BackLinks({ toProjects, toExplore }: { toProjects?: () => void; toExplore?: () => void }) {
  const fromExplore = useFromExplore();
  const explore = fromExplore ? toExplore : undefined;
  if (!toProjects && !explore) return null;
  return (
    <div className="shrink-0 flex items-center">
      {toProjects && <BackTo place="Projects" onBack={toProjects} />}
      {explore && <BackTo place="Explore" onBack={explore} />}
    </div>
  );
}

/** Back to a place, named. */
function BackTo({ place, onBack }: { place: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={`Back to ${place}`}
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
      {place}
    </button>
  );
}
