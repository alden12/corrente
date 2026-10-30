/**
 * The clip pool for the selected track: a chip per clip (a note pattern), plus
 * "+ Clip" to add a new empty one. Clicking a chip makes it the active clip
 * (shown/edited in the roll); double-click renames; drag a chip onto this track's
 * lane in the arrangement to place that clip there. Each chip is in the clip's colour (DAW-47: its
 * own, else its track's), with a dot in its maker's colour. Selecting is navigation
 * (direct on the store); add / remove / rename go through dispatch, so undo/redo +
 * the activity feed cover them.
 */
import { type ReactNode } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { ClipStore } from "../audio/sequencer/clipStore";
import { useProject } from "../audio/project/useProject";
import type { Dispatch } from "../audio/commands/types";
import { newClipId } from "../audio/commands/ids";
import { InlineRename } from "./InlineRename";
import { ClipPreview } from "./shell/ClipPreview";
import { beatsPerBar as beatsPerBarOf } from "../audio/project/schema";
import { clipContentOf as clipContentOfTrack } from "./clipContent";
import { CLIP_DND_TYPE, clipDndKindType, clearDraggedClip, setDraggedClip } from "./clipDnd";
import { copiedClip, copyClip as copyToClipboard } from "./clipboard";
import { authorDotStyle, authorLabel } from "./authorStyle";
import { paletteAccent } from "./deviceColor";
import { clipColorMenu } from "./clipColorMenu";
import { useAuthorPresence } from "./authorColorsContext";
import { PagedStrip } from "./controls/PagedStrip";
import type { MenuItem } from "./Menu";
import { useContextMenu } from "./useContextMenu";

export function ClipRail({
  projectStore,
  scheduler,
  trackId,
  dispatch,
  orientation = "horizontal",
  dense = false,
  chipsOnly = false,
  deleting = false,
  footer,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  trackId: string;
  dispatch: Dispatch;
  /**
   * 'vertical' left rail (stacked, beside the roll); 'horizontal' a single scrolling
   * chip row; 'grid' a wrapping field of larger chips filling a whole panel - the touch
   * shell's Clips tab (MOBILE-1), where launching is a performance gesture and the
   * targets should be big.
   */
  orientation?: "horizontal" | "vertical" | "grid";
  /** A grid of narrow chips, as many to a row as fit: the desktop's open clips line (DAW-61.1). */
  dense?: boolean;
  /**
   * The chips and nothing else: no title, no "+ Clip", no footer, no padding of its own. The
   * desktop column puts them in its clips section, whose header carries the title, + and record.
   */
  chipsOnly?: boolean;
  /**
   * Delete mode: each chip shows a delete button big enough to aim at. Without it the chips in the
   * column have none, so a tap meant to pick a clip never removes one.
   */
  deleting?: boolean;
  /** Bottom action below the clip list (e.g. a record button), for either kind. */
  footer?: ReactNode;
}) {
  const project = useProject(projectStore);
  const presence = useAuthorPresence();
  const { openAt, menu } = useContextMenu();
  const track = project.tracks.find((track) => track.id === trackId);
  if (!track) return null;

  const { clips, activeClipId, launchedClipId } = track;
  const vertical = orientation === "vertical";
  const grid = orientation === "grid";

  // Delete a clip. A track must keep at least one clip, so deleting the last one
  // replaces it with a fresh empty clip (a blank-slate reset). The new id is minted
  // here and carried in the edit, so undo/redo and history replay stay deterministic.
  const deleteClip = (clipId: string) => {
    if (clips.length > 1) {
      dispatch({ type: "removeClip", trackId, clipId });
    } else {
      dispatch({ type: "addClip", trackId, id: newClipId(), empty: true });
      dispatch({ type: "removeClip", trackId, clipId });
    }
  };

  // Launch toggles the clip's override; launching auto-starts the transport so you
  // hear it immediately (no-op if audio is not started or already playing).
  const toggleLaunch = (clipId: string) => {
    const launched = launchedClipId === clipId;
    dispatch({ type: "launchClip", trackId, clipId: launched ? null : clipId });
    if (!launched) scheduler.play();
  };

  const clipContentOf = (clipId: string) => clipContentOfTrack(projectStore, trackId, clipId);

  // Copy / cut / paste clips, like the timeline does for placements. Cut/copy take
  // the active clip; paste adds the clipboard clip to THIS track (refusing a
  // cross-type paste), so clips move within and across same-kind tracks.
  /** Copy a clip, and say whether there was one to copy. */
  const copyClip = (clipId: string): boolean => {
    const content = clipContentOf(clipId);
    if (content) copyToClipboard({ content, source: { trackId, clipId } });
    return Boolean(content);
  };
  /** Cut keeps a track's last clip: there's always one to edit. */
  const cutClip = (clipId: string): boolean => {
    const copied = copyClip(clipId);
    if (copied && clips.length > 1) dispatch({ type: "removeClip", trackId, clipId });
    return copied;
  };
  /** What the clipboard holds, if this track can take it (a MIDI clip on a MIDI track, and so on). */
  const pasteable = () => {
    const content = copiedClip()?.content;
    return content?.kind === track.kind ? content : undefined;
  };
  const pasteClip = (): boolean => {
    const content = pasteable();
    if (content) dispatch({ type: "pasteClip", trackId, id: newClipId(), content });
    return Boolean(content);
  };
  const shortcuts: Record<string, () => boolean> = {
    c: () => copyClip(activeClipId),
    x: () => cutClip(activeClipId),
    v: pasteClip,
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const el = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // typing (rename) keeps normal copy/paste
    if (!shortcuts[e.key.toLowerCase()]?.()) return;
    e.preventDefault();
    e.stopPropagation();
  };

  /** A clip's actions, from a right-click (DAW-74): the keys' copy, cut and paste, and the chip's buttons. */
  /** Its "Colour" submenu, a colour of its own or its track's (DAW-47). */
  const clipColor = (clipId: string): MenuItem[] => {
    const clip = clips.find((each) => each.id === clipId);
    return clip ? [clipColorMenu(track, clip, dispatch)] : [];
  };
  const clipItems = (clipId: string): MenuItem[] => {
    const launched = launchedClipId === clipId;
    return [
      { label: "Copy", onClick: () => void copyClip(clipId) },
      { label: "Cut", disabled: clips.length <= 1, onClick: () => void cutClip(clipId) },
      { label: "Paste", disabled: !pasteable(), onClick: () => void pasteClip() },
      {
        label: "Duplicate",
        onClick: () => dispatch({ type: "addClip", trackId, id: newClipId(), fromClipId: clipId }),
      },
      { separator: true },
      { label: launched ? "Stop" : "Launch", onClick: () => toggleLaunch(clipId) },
      ...clipColor(clipId),
      { separator: true },
      ...(track.kind === "audio" && clips.length <= 1
        ? []
        : [{ label: clips.length > 1 ? "Delete" : "Clear", danger: true, onClick: () => deleteClip(clipId) }]),
    ];
  };

  // The horizontal and grid layouts are the touch ones (MOBILE-1): roomier padding on
  // both axes so the chips are comfortable tap targets rather than a squashed strip.
  const containerClass = chipsOnly
    ? grid
      ? "flex flex-wrap content-start gap-2 p-2.5"
      : "gap-1.5"
    : vertical
      ? "flex flex-col gap-1.5 p-2 w-full min-h-0 border-r border-line bg-panel overflow-y-auto"
      : grid
        ? "flex flex-wrap content-start gap-2 p-3 flex-1 min-h-0 overflow-y-auto"
        : "flex items-center gap-2 px-3 py-2.5 border-b border-line overflow-x-auto shrink-0";
  // Padding lives here (not in the chip's own class) so the orientations can differ
  // without two conflicting Tailwind padding utilities on one element.
  // Two per row in the touch grid, so a chip is a comfortable target and the names have room;
  // dense, as many narrow ones as fit, for a mouse.
  const chipClass = vertical
    ? "w-full py-1"
    : grid
      ? dense
        ? "w-36 py-2"
        : "grow basis-[calc(50%-0.25rem)] py-2.5"
      : // A long name truncates rather than stretching its chip across the strip.
        chipsOnly
        ? "shrink-0 max-w-44 py-1"
        : "shrink-0 max-w-44 py-1.5";
  // The rail and the grid stack a glance at the clip's notes under its name, at the chip's full
  // width; the horizontal strip is one line, so the glance sits inline there.
  const stacked = vertical || grid;

  const content = (
    <>
      {!chipsOnly && (
        <span
          className={`font-mono text-[10px] tracking-[0.16em] uppercase text-faint shrink-0 mr-1 ${grid ? "w-full" : ""}`}
        >
          Clips
        </span>
      )}
      {clips.map((clip) => {
        const active = clip.id === activeClipId;
        return (
          <div
            key={clip.id}
            draggable
            onDragStart={(e) => {
              const content = clipContentOf(clip.id);
              if (!content) return;
              e.dataTransfer.setData(CLIP_DND_TYPE, clip.id);
              e.dataTransfer.setData(clipDndKindType(track.kind), "");
              e.dataTransfer.effectAllowed = "copy";
              setDraggedClip(content);
            }}
            onDragEnd={() => clearDraggedClip()}
            className={`group ${chipClass} ${
              stacked ? "relative flex flex-col gap-1 rounded-lg" : "inline-flex items-center gap-1.5 rounded-full"
            } font-mono text-[11px] pl-1.5 pr-1.5 border cursor-grab active:cursor-grabbing ${
              active ? "text-strong" : "text-muted hover:text-ink"
            }`}
            // In the clip's colour (DAW-47: its own, else its track's), stronger when it's the open one.
            style={{
              borderColor: paletteAccent(clip.color ?? track.color, active ? 0.9 : 0.4),
              background: paletteAccent(clip.color ?? track.color, active ? 0.26 : 0.1),
            }}
            onClick={() => projectStore.selectClip(trackId, clip.id)}
            onContextMenu={(e) => {
              projectStore.selectClip(trackId, clip.id);
              openAt(e, () => clipItems(clip.id));
            }}
            // The full name too: a long one is truncated on the chip.
            title={`${clip.name} · ${authorLabel(clip.author, presence.self)} - drag onto the lane to place`}
          >
            <div className={stacked ? "flex items-center gap-1.5 min-w-0" : "contents"}>
              <button
                type="button"
                title={
                  launchedClipId === clip.id ? "Stop (back to timeline)" : "Launch clip (loops, overrides the timeline)"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLaunch(clip.id);
                }}
                className={`font-mono text-[9px] leading-none w-4 h-4 rounded-full border cursor-pointer shrink-0 inline-flex items-center justify-center ${
                  launchedClipId === clip.id
                    ? "border-you bg-you text-ground"
                    : "border-line text-muted hover:text-you hover:border-you"
                }`}
              >
                {/* The optical nudge belongs to the glyph, not the button (DAW-8.4). `▶` is
                    left-weighted and needs pushing right to look centred; `■` is symmetric and the
                    same nudge visibly knocked it off centre in a 16px circle. */}
                {launchedClipId === clip.id ? "■" : <span className="pl-px pb-px">▶</span>}
              </button>
              {/* Who made it, in their colour. */}
              <span
                aria-hidden="true"
                className="w-1.5 h-1.5 shrink-0 rounded-full"
                style={authorDotStyle(clip.author, presence)}
              />
              <InlineRename
                value={clip.name}
                onCommit={(name) => dispatch({ type: "renameClip", trackId, clipId: clip.id, name })}
                className="min-w-0 flex-1"
              />
              {/* Audio's last clip has no empty-clip fallback, so hide its no-op delete. */}
              {(deleting || !chipsOnly) && !(track.kind === "audio" && clips.length <= 1) && (
                <button
                  type="button"
                  title={clips.length > 1 ? "Remove clip" : "Clear clip (replaces it with a fresh empty one)"}
                  aria-label={`${clips.length > 1 ? "Remove" : "Clear"} ${clip.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteClip(clip.id);
                  }}
                  // The grid shows it outright; the rail reveals it on hover, where there is hover. In the
                  // narrow vertical rail it floats over the end of the name rather than taking a column of
                  // its own, so a name like "Clip 1" fits without widening the rail.
                  className={
                    deleting
                      ? "shrink-0 flex items-center justify-center w-7 h-7 pointer-coarse:w-9 pointer-coarse:h-9 rounded-md bg-hot/15 text-hot text-[18px] leading-none cursor-pointer hover:bg-hot/25"
                      : `font-mono text-[11px] w-4 h-4 rounded text-faint hover:text-ink cursor-pointer ${
                          grid
                            ? ""
                            : vertical
                              ? "reveal-on-hover absolute top-1 right-1 bg-[inherit]"
                              : "reveal-on-hover"
                        }`
                  }
                >
                  ×
                </button>
              )}
            </div>
            {/* What is in it, at a glance, so clips are told apart by more than their names. */}
            {track.kind === "instrument" && (
              <span
                aria-hidden="true"
                className={`rounded-sm overflow-hidden pointer-events-none empty:hidden ${
                  stacked ? "block h-4" : "order-last shrink-0 w-8 h-3.5"
                }`}
              >
                <ChipPreview
                  store={projectStore.getClipStore(trackId, clip.id)}
                  name={clip.name}
                  beatsPerBar={beatsPerBarOf(project.timeSignature)}
                />
              </span>
            )}
          </div>
        );
      })}
      {/* Instrument tracks keep "+ Clip"; audio clips only ever arrive by recording
          or import. Both kinds get the record button below (passed as `footer`). */}
      {track.kind === "instrument" && !chipsOnly && (
        <button
          type="button"
          title="Add a new empty clip"
          onClick={() => dispatch({ type: "addClip", trackId, id: newClipId(), empty: true })}
          // Bare: adding a clip is available, not urgent, and a filled accent chip at the end
          // of the rail competed with the clips themselves for the eye.
          className={`${chipClass} font-mono text-[11px] px-2.5 rounded-full border border-transparent text-muted hover:text-you hover:bg-control cursor-pointer whitespace-nowrap transition-colors`}
        >
          + Clip
        </button>
      )}
      {/* Vertical: the rail is full-height, so the record button belongs at its foot rather
          than trailing the last clip. Other orientations keep it inline (`contents`). */}
      {footer && !chipsOnly && <div className={vertical ? "mt-auto shrink-0 pt-2" : "contents"}>{footer}</div>}
      {menu}
    </>
  );
  const keys = { "data-clip-rail": true, tabIndex: 0, onKeyDown };
  // In a header, a strip that pages; elsewhere, its own scroller.
  if (chipsOnly && !grid)
    return (
      <PagedStrip label="clips" count={clips.length} className={`${containerClass} outline-none`} scrollerProps={keys}>
        {content}
      </PagedStrip>
    );
  return (
    <div className={`${containerClass} outline-none`} {...keys}>
      {content}
    </div>
  );
}

/** A chip's glance at its notes. The rail renders from the store-free structure, so it asks the
 * project for the clip's live store; nothing for an empty clip, or one not found. */
function ChipPreview({
  store,
  name,
  beatsPerBar,
}: {
  store: ClipStore | undefined;
  name: string;
  beatsPerBar: number;
}) {
  return store ? <ClipPreview store={store} name={name} beatsPerBar={beatsPerBar} empty={null} /> : null;
}
