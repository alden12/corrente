import { writePersistent } from "../persistentStore";

/**
 * Which Projects page is showing: the list of projects, or the inside of the open one. Shared and
 * persisted, so the phone's tab, the desktop's view and the panel header agree, and a reload comes
 * back to the same place.
 */
export type ProjectsPage = "home" | "inside";

export const PROJECTS_PAGE_KEY = "corrente:projects-page";
export const PROJECTS_PAGES: readonly ProjectsPage[] = ["home", "inside"];

/**
 * Projects starts on the open project (2026-10-13, Alden): it is the project you came to look at,
 * and the list is one step up, behind "‹ Projects".
 */
export const PROJECTS_PAGE_DEFAULT: ProjectsPage = "inside";

export const openProjectsPage = (page: ProjectsPage) => writePersistent(PROJECTS_PAGE_KEY, page);
