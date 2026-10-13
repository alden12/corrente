/**
 * Which Explore page is open: home, or a category. Shared and persisted rather than the view's own
 * state, so it survives a reload or a trip to another tab, and so something outside Explore can
 * send you to a page - the Sampler's "reveal samples" link opens the Samples category.
 */
import { writePersistent } from "../persistentStore";
import { CATEGORY_ORDER, type ExploreCategory } from "./exploreItems";

export type ExplorePage = ExploreCategory | "home";

export const EXPLORE_PAGE_KEY = "corrente:explore-page";
export const EXPLORE_PAGES: readonly ExplorePage[] = ["home", ...CATEGORY_ORDER];

export const openExplorePage = (page: ExplorePage) => writePersistent(EXPLORE_PAGE_KEY, page);

/**
 * A request to search (COMM-1.9.3): the desktop rail's Search icon opens Explore home with its box
 * focused. Held until the box exists to take it, since Explore may not be on screen, or may be on a
 * category page, at the moment it is asked.
 */
let searchRequested = false;
const searchListeners = new Set<() => void>();

export function requestExploreSearch(): void {
  openExplorePage("home");
  searchRequested = true;
  searchListeners.forEach((listener) => listener());
}

/** Whether a search was asked for since the last take; taking it clears it. */
export function takeExploreSearchRequest(): boolean {
  const requested = searchRequested;
  searchRequested = false;
  return requested;
}

export function subscribeExploreSearch(listener: () => void): () => void {
  searchListeners.add(listener);
  return () => searchListeners.delete(listener);
}
