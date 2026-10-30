/**
 * Explore (COMM-1.9.1): the library's one place for taking a device, replacing its separate
 * Instruments / Effects / Patches / Samples views. The same component fills the desktop panel and
 * the touch shell's Explore tab.
 *
 * Two pages. **Home** is a search box, tag chips and the category tiles; searching or picking a
 * tag swaps the tiles for matching rows from every category. A **category page** is a playlist:
 * header, count, tag filters, numbered rows. Favourites (COMM-1.9.3) is a category like the rest,
 * holding what you have hearted from all of them, newest first. Shelves (Most favourited, Most added) join home
 * once there is a published catalogue to rank (COMM-1.9.4).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { useProject } from "../../audio/project/useProject";
import type { Tag } from "../../audio/tags";
import type { SoundPreview } from "../../audio/live/preview";
import { ExploreList } from "./ExploreList";
import { ExploreShelf } from "./ExploreShelf";
import { itemTaps } from "./itemTaps";
import { useRecent } from "./recent/useRecent";
import { ExploreThumb } from "./ExploreThumb";
import { SampleImport } from "./SampleImport";
import { search } from "../../audio/search";
import { TagChips } from "./TagChips";
import {
  byName,
  CATEGORIES,
  CATEGORY_KIND,
  CATEGORY_ORDER,
  type ExploreCategory,
  type ExploreItem,
  exploreItems,
  favouriteItems,
  itemsByKey,
  groupByCategory,
  hasTags,
  rankTags,
  tagsIn,
} from "./exploreItems";
import { useLibraryActions } from "./useLibraryActions";
import { useExploreScope } from "./exploreScope";
import { useSavedPatches } from "./useSavedPatches";
import { useFavourites } from "./favourites/useFavourites";
import {
  EXPLORE_PAGE_KEY,
  EXPLORE_PAGES,
  subscribeExploreSearch,
  takeExploreSearchRequest,
  type ExplorePage,
} from "./explorePage";
import { usePersistentString } from "../usePersistent";
import { MakeYourOwn, YourWork, type ExploreLinks } from "./ExploreHomeLinks";
import { mcpConnected } from "../../audio/mcp/bridge";

export type { ExploreLinks } from "./ExploreHomeLinks";

/** What an empty category page says, before any tag filter. */
const EMPTY_HINT: Record<ExploreCategory, string> = {
  favourites: "Tap the heart on any device and it waits for you here, in every project.",
  instruments: "Nothing here yet.",
  patches: "Save a track's sound as a patch and it appears here.",
  effects: "Nothing here yet.",
  midi: "Nothing here yet.",
  samples: "Import a sample to play it with the Sampler.",
};

/** A heading over one group of search results. */
function SectionLabel({ children }: { children: string }) {
  return <div className="px-3.5 pt-2.5 font-mono text-[10px] uppercase tracking-wider text-faint">{children}</div>;
}

function Hint({ children }: { children: string }) {
  return <p className="px-3.5 py-2 text-[11.5px] text-faint">{children}</p>;
}

/** "9 · all built-in", "13 · 11 built-in, 2 yours": where a category's contents come from. */
function countLine(items: ExploreItem[]) {
  const builtin = items.filter((item) => item.builtin).length;
  const yours = items.length - builtin;
  if (items.length === 0) return "Nothing here yet";
  if (yours === 0) return `${items.length} · all built-in`;
  if (builtin === 0) return `${items.length} · all yours`;
  return `${items.length} · ${builtin} built-in, ${yours} yours`;
}

export function ExploreView({
  projectStore,
  dispatch,
  onPicked,
  preview,
  shown,
  onShow,
  links,
}: {
  projectStore: ProjectStore;
  dispatch: Dispatch;
  onPicked: (act: () => void) => void;
  /** Tapping an instrument or patch tries it here (COMM-1.4.1). */
  preview: SoundPreview;
  /** The key of the effect shown in its panel, if one is, so its row and card show it. */
  shown: string | undefined;
  /** Show an effect in its panel, rather than add it at once. */
  onShow: (item: ExploreItem) => void;
  /** Ways out to your projects, and the MCP state for the "make your own" card. None in the plugin. */
  links?: ExploreLinks;
}) {
  const project = useProject(projectStore);
  // The item in the panel under Explore, whichever kind: a sound being tried, or an effect shown.
  const trying = useSyncExternalStore(preview.subscribe, preview.getState)?.key ?? shown;
  const savedPatches = useSavedPatches();
  const favourites = useFavourites();
  const recent = useRecent();
  const actions = useLibraryActions(projectStore, dispatch);
  const [page, setPage] = usePersistentString<ExplorePage>(EXPLORE_PAGE_KEY, "home", EXPLORE_PAGES);
  const category = page === "home" ? null : page;
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  // Focus the box when asked to (the desktop rail's Search). Re-checked as the page changes, since
  // the box only exists on the home page and a request can arrive while a category is open.
  useEffect(() => {
    const focusIfAsked = () => {
      if (searchBox.current && takeExploreSearchRequest()) searchBox.current.focus();
    };
    focusIfAsked();
    return subscribeExploreSearch(focusIfAsked);
  }, [page]);
  const [picked, setPicked] = useState<Tag[]>([]);
  const toggleTag = (tag: Tag) =>
    setPicked((current) => (current.includes(tag) ? current.filter((each) => each !== tag) : [...current, tag]));
  const pickedLine = picked.map((tag) => `#${tag}`).join(" ");
  /** The chips for a page: ranked over what is on screen, with every tag in its pool behind "More". */
  const chips = (pool: ExploreItem[], shown: ExploreItem[]) => (
    <TagChips tags={rankTags(shown, picked)} all={tagsIn(pool)} picked={picked} onToggle={toggleTag} />
  );

  // What this window takes (`ExploreScope`): the plugin's lists only what it plays.
  const { kinds } = useExploreScope();
  const items = exploreItems({ savedPatches, samples: project.samples, project: projectStore }).filter((item) =>
    kinds.has(item.source.kind),
  );
  const categories = CATEGORY_ORDER.filter((key) => key === "favourites" || kinds.has(CATEGORY_KIND[key]));

  // Favourites keep the order you hearted them in, newest first; every other category reads A to Z.
  const inCategory = (key: ExploreCategory) =>
    key === "favourites"
      ? favouriteItems(items, favourites)
      : items.filter((item) => item.category === key).sort(byName);
  const list = (shown: ExploreItem[], showKind = false) => (
    <ExploreList
      items={shown}
      actions={actions}
      dispatch={dispatch}
      onPicked={onPicked}
      showKind={showKind}
      preview={preview}
      trying={trying}
      onShow={onShow}
    />
  );

  // Tag filters are per page: opening a category or going back home starts unfiltered.
  const openPage = (next: ExploreCategory | null) => {
    setPage(next ?? "home");
    setPicked([]);
  };

  if (category) {
    const all = inCategory(category);
    const shown = all.filter((item) => hasTags(item, picked));
    return (
      <div className="pb-2">
        <button
          type="button"
          onClick={() => openPage(null)}
          aria-label="Back to Explore"
          // Stays at the top of the panel as the page scrolls, so the way back is always in reach.
          className="sticky top-0 z-10 w-full bg-rail flex items-center gap-1 h-9 px-2.5 text-[12.5px] text-you cursor-pointer"
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
          Explore
        </button>
        <div className="flex items-end gap-3 px-3.5">
          <ExploreThumb category={category} size={72} />
          <div className="min-w-0 pb-0.5">
            <div className="font-mono text-[9.5px] tracking-widest text-you">CATEGORY</div>
            <h2 className="text-[20px] font-semibold text-strong leading-tight truncate">
              {CATEGORIES[category].label}
            </h2>
            <div className="text-[11.5px] text-muted">{countLine(all)}</div>
          </div>
        </div>
        <div className="px-3.5 pt-3 pb-1 flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
            {category === "favourites" ? "Newest first" : "A to Z"}
          </div>
          {chips(all, shown)}
        </div>
        {category === "samples" && <SampleImport samples={project.samples} dispatch={dispatch} />}
        {shown.length > 0 ? (
          // Favourites mix every category, so each row says which it is from.
          list(shown, category === "favourites")
        ) : picked.length > 0 ? (
          <Hint>{`Nothing here is tagged ${pickedLine}.`}</Hint>
        ) : (
          <Hint>{EMPTY_HINT[category]}</Hint>
        )}
      </div>
    );
  }

  const filtering = query.trim() !== "" || picked.length > 0;
  // Forgiving spelling: a word like nothing listed is read as the nearest term, and the count says so.
  const { items: searched, readAs } = search(items, query);
  const results = searched.filter((item) => hasTags(item, picked));
  const matchCount = results.length;

  return (
    <div className="pb-2">
      {/* The search stays at the top while the rest scrolls under it, on the library's own ground. */}
      <div className="sticky top-0 z-10 bg-rail px-3 pt-3 pb-2.5">
        <label className="flex items-center gap-2 h-8 pointer-coarse:h-11 px-2.5 rounded-md border border-line bg-ground text-faint focus-within:border-you">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            className="w-4 h-4 shrink-0"
          >
            <circle cx="7" cy="7" r="4.25" />
            <path d="M10.2 10.2 13.5 13.5" />
          </svg>
          <input
            ref={searchBox}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sounds, or #tags"
            aria-label="Search Explore"
            className="flex-1 min-w-0 bg-transparent text-ink text-[12.5px] pointer-coarse:text-[15px] placeholder:text-faint outline-none"
          />
        </label>
      </div>
      {/* A container, so the tiles fit the panel they are in rather than the window. */}
      <div className="@container px-3 pb-3 flex flex-col gap-2.5">
        {chips(searched, results)}
        {!filtering && (
          <div className="grid grid-cols-1 @[17rem]:grid-cols-2 gap-1.5 mt-0.5">
            {categories.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => openPage(key)}
                className="flex items-center gap-2 h-11 pointer-coarse:h-13 pr-2 rounded-md bg-stage overflow-hidden text-left cursor-pointer hover:bg-you/10"
              >
                <ExploreThumb category={key} size={44} />
                <span className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-strong">
                  {CATEGORIES[key].label}
                </span>
                <span className="font-mono text-[10px] text-faint">{inCategory(key).length}</span>
              </button>
            ))}
          </div>
        )}
        {!filtering && links && <YourWork name={projectStore.name} links={links} />}
      </div>
      {/* Shelves (board FeedHome): what you used lately, then what you hearted. Each hides while empty.
          Favourites also has its tile; the shelf puts them on the home page, artwork and all. */}
      {!filtering && (
        <div className="flex flex-col gap-3">
          <ExploreShelf
            title="Recently used"
            items={itemsByKey(items, recent)}
            taps={itemTaps(preview, actions, onPicked, onShow)}
            trying={trying}
          />
          <ExploreShelf
            title="Favourites"
            items={favouriteItems(items, favourites)}
            taps={itemTaps(preview, actions, onPicked, onShow)}
            trying={trying}
          />
          {links?.mcpStatus && !mcpConnected(links.mcpStatus) && <MakeYourOwn />}
        </div>
      )}
      {filtering &&
        (matchCount > 0 ? (
          <>
            <div className="px-3.5 text-[11px] text-faint">
              {matchCount} {matchCount === 1 ? "match" : "matches"}
              {readAs &&
                `, for ${Object.entries(readAs)
                  .map(([typed, read]) => `“${read}” (you typed “${typed}”)`)
                  .join(", ")}`}
            </div>
            {/* Grouped like the tiles. Explore searches what you can add; your projects and tracks have
                searches of their own, where they live (decided 2026-10-12). */}
            {groupByCategory(results).map((group) => (
              <section key={group.category} aria-label={CATEGORIES[group.category].label}>
                <SectionLabel>{CATEGORIES[group.category].label}</SectionLabel>
                {list(group.items)}
              </section>
            ))}
          </>
        ) : (
          <Hint>{`Nothing matches${query.trim() ? ` “${query.trim()}”` : ""}${picked.length ? ` tagged ${pickedLine}` : ""}.`}</Hint>
        ))}
    </div>
  );
}
