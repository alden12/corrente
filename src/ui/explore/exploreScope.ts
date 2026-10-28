/**
 * Where Explore takes things into (PLUGIN-3.5). The app's project has tracks to add, so a sound taken
 * from Explore can be a new one. The plugin's window is one track's rack: a sound taken replaces that
 * track's, and only the kinds the plugin plays are listed. The app leaves the default; the plugin's
 * page provides its own.
 */
import { createContext, useContext } from "react";
import type { ItemSource } from "./exploreItems";

export interface ExploreScope {
  /** Taking a sound replaces the selected track's, rather than adding a track. */
  oneTrack: boolean;
  /** The kinds of item listed. */
  kinds: ReadonlySet<ItemSource["kind"]>;
}

const APP_SCOPE: ExploreScope = {
  oneTrack: false,
  kinds: new Set(["instrument", "patch", "effect", "midi", "sample"]),
};

const ExploreScopeContext = createContext<ExploreScope>(APP_SCOPE);

export const ExploreScopeProvider = ExploreScopeContext.Provider;

export const useExploreScope = (): ExploreScope => useContext(ExploreScopeContext);
