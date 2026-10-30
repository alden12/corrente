/**
 * One track's lane on the arrangement: the placement blocks over the beat grid,
 * the clip-from-rail drop target, and the pointer gestures (place / select / move /
 * resize / split). Selection is lifted to the timeline so the lanes and the piano
 * roll agree on what's active. `Block` and `NoteMinis` are the lane's own block
 * rendering, kept here since nothing else uses them.
 */
import { useRef, useState, type RefObject } from "react";
import type { Track } from "../../audio/project/projectStore";
import type { ClipStore } from "../../audio/sequencer/clipStore";
import type { Placement } from "../../audio/project/types";
import type { Dispatch } from "../../audio/commands/types";
import { GRID } from "../../audio/sequencer/types";
import { useClip } from "../../audio/sequencer/useClip";
import { paletteAccent } from "../deviceColor";
import { clipColorMenu } from "../clipColorMenu";
import { CreatorDot } from "../CreatorDot";
import type { DeviceColor } from "../../audio/deviceColors";
import { newClipId, newPlacementId } from "../../audio/commands/ids";
import { beginPointerDrag } from "../pointerDrag";
import { Waveform } from "../Waveform";
import { CLIP_DND_TYPE, clipDndKindType, getDraggedClip } from "../clipDnd";
import { beatToX, floorBeat, snapBeat, xToBeat } from "../timeline/timeGrid";
import { ObjectHandles } from "../editing/ObjectHandles";
import type { MenuItem } from "../Menu";
import { MarkerMenu } from "./MarkerMenu";
import { LaunchedClip } from "./LaunchedClip";
import { useContextMenu } from "../useContextMenu";
import { ROW, ROW_PX, RULER_H, RESIZE_PX, DRAG_THRESH, type Selection } from "./shared";

/** The block's `top-1.5 bottom-1.5` inset, as a number the handles can be placed against. */
const BLOCK_INSET_Y = 6;

/** A placement block: pixel-positioned region with a label, shared by both kinds. In its clip's
 *  colour (DAW-47: its own, else its track's), with a dot by its name when someone else made it. */
/** A soft outline in the block's fill colour around a clip's name, so notes under it don't swallow it. */
const NAME_HALO = "0 0 2px var(--color-card), 0 0 2px var(--color-card), 0 0 1px var(--color-card)";

function Block({
  name,
  color,
  creator,
  left,
  width,
  selected,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
  children,
}: {
  name?: string;
  color: DeviceColor;
  /** Who made the clip, for the dot by its name. */
  creator?: string;
  left: number;
  width: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  const edge = paletteAccent(color);
  return (
    <div
      data-testid="placement"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      // Square, unlike the pill-shaped clips on the rail. A block here is a span of time
      // whose ends are edges you line up against the grid, so it has to end where it ends;
      // a round cap would round off the only thing the shape is for.
      className={`absolute top-1.5 bottom-1.5 rounded border overflow-hidden cursor-grab touch-none ${
        selected ? "" : "border-t-2 border-line bg-card hover:bg-card/70"
      }`}
      style={{
        ...(selected
          ? { borderColor: edge, background: paletteAccent(color, 0.3), boxShadow: `0 0 0 1px ${edge}` }
          : { borderTopColor: edge }),
        left,
        width: Math.max(3, width),
      }}
      title={name}
    >
      <div className="absolute inset-0" style={{ background: paletteAccent(color, 0.16) }} />
      {children}
      {/* Haloed in the block's own colour, so the name reads over the notes drawn under it. */}
      <span
        className="absolute left-1.5 top-1 flex items-center gap-1 max-w-full pr-1 font-mono text-[9px] text-muted"
        style={{ textShadow: NAME_HALO }}
      >
        {creator && <CreatorDot author={creator} />}
        <span className="truncate">{name}</span>
      </span>
      {/* right-edge resize affordance */}
      <div className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize" />
    </div>
  );
}

/**
 * Mini note summary of an instrument clip, tiled across the placement window so a
 * looped clip (a window longer than the clip) shows its repeats, with a faint
 * divider at each loop boundary. Mirrors the scheduler's `tileClipNotes` math.
 */
function NoteMinis({
  store,
  placement,
  pxPerBeat,
  color,
}: {
  store: ClipStore;
  placement: Placement;
  pxPerBeat: number;
  /** The block's colour, which its notes are drawn in. */
  color: DeviceColor;
}) {
  const clip = useClip(store);
  const clipLen = clip.lengthBeats;
  if (clipLen <= 0) return null;
  const body = clip.notes.filter((note) => note.start >= 0 && note.start < clipLen);
  const pitches = body.map((note) => note.pitch);
  const lo = pitches.length ? Math.min(...pitches) : 48;
  const hi = pitches.length ? Math.max(...pitches) : 72;
  const span = Math.max(1, hi - lo);

  // Tiled note onsets (arrangement-relative beats), and loop-boundary dividers.
  const tiles: { key: string; tau: number; note: (typeof body)[number] }[] = [];
  for (const note of body) {
    let phase = (note.start - placement.offset) % clipLen;
    if (phase < 0) phase += clipLen;
    for (let tau = phase; tau < placement.length; tau += clipLen) tiles.push({ key: `${note.id}:${tau}`, tau, note });
  }
  const dividers: number[] = [];
  let first = -placement.offset % clipLen;
  if (first < 0) first += clipLen;
  for (let tau = first; tau < placement.length; tau += clipLen) if (tau > 0.001) dividers.push(tau);

  return (
    <>
      {/* Where the clip starts again: a line with a notch at the top, so a repeat reads as one. */}
      {dividers.map((tau) => (
        <div
          key={`d${tau}`}
          data-testid="loop-mark"
          className="absolute top-0 bottom-0 w-px bg-you/50 pointer-events-none"
          style={{ left: beatToX(tau, pxPerBeat) }}
        >
          <span className="absolute top-0 -left-[3px] border-x-[3.5px] border-x-transparent border-t-[5px] border-t-you" />
        </div>
      ))}
      {tiles.map(({ key, tau, note }) => (
        <div
          key={key}
          className="absolute h-0.5 rounded-[1px] pointer-events-none"
          style={{
            background: paletteAccent(color, 0.9),
            left: beatToX(tau, pxPerBeat),
            width: Math.max(2, beatToX(note.length, pxPerBeat)),
            bottom: `${((note.pitch - lo) / span) * 60 + 18}%`,
          }}
        />
      ))}
    </>
  );
}

/**
 * One track's lane: an editable strip of placement blocks over the beat grid.
 * Owns the pointer gestures (place / select / move / resize / split) and reports
 * edits through the dispatch; selection is lifted to the parent so the roll and
 * the lanes agree on what's active.
 */
export function Lane({
  track,
  width,
  pxPerBeat,
  beatsPerBar,
  snapOn,
  snapDiv,
  selection,
  markerBeat,
  dropBeat,
  headerW,
  stickyHeader,
  scrollRef,
  onSelect,
  onMark,
  onCopy,
  canPaste,
  onPaste,
  onHover,
  dispatch,
}: {
  track: Track;
  width: number;
  pxPerBeat: number;
  beatsPerBar: number;
  snapOn: boolean;
  snapDiv: number;
  selection: Selection;
  markerBeat: number | null;
  dropBeat: number | null;
  /** The track-header column's width, which is where this lane starts in the scrolled content. */
  headerW: number;
  /** Whether that column is pinned, in which case it also covers the lane's left edge. */
  stickyHeader: boolean;
  /** The timeline's scroller, so a selected clip's kebab can be clamped into view. */
  scrollRef: RefObject<HTMLElement | null>;
  onSelect: (trackId: string, p: Placement) => void;
  onMark: (trackId: string, beat: number) => void;
  /** Copy a placement to the timeline's clipboard (the clip kebab's Copy). */
  onCopy: (placement: Placement) => void;
  /** Whether the clipboard holds a clip this track can take, asked while the marker's menu is open. */
  canPaste: () => boolean;
  /** Paste the clipboard at a beat on this track. */
  onPaste: (beat: number) => void;
  onHover: (beat: number | null) => void;
  dispatch: Dispatch;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ left: number; width: number } | null>(null);
  const selectedPlacement =
    selection?.trackId === track.id ? track.placements.find((placement) => placement.id === selection.id) : undefined;
  const beatAt = (clientX: number) => xToBeat(clientX - (ref.current?.getBoundingClientRect().left ?? 0), pxPerBeat);
  const snapB = (b: number) => (snapOn ? snapBeat(b, snapDiv) : b);
  const floorB = (b: number) => floorBeat(b, snapOn ? snapDiv : GRID);

  /** Place one of this track's own clips at a beat, and select the placement. */
  const placeClipAt = (clipId: string, startBeat: number) => {
    const id = newPlacementId();
    dispatch({ type: "addPlacement", trackId: track.id, id, clipId, startBeat });
    onSelect(track.id, { id, clipId, startBeat, offset: 0, length: 0 });
  };

  // Drop a clip dragged from a clip rail at the cursor. Any same-kind track's lane
  // accepts: dropping on the clip's own track places the existing clip; dropping on
  // another same-kind track copies the clip into that track's pool first, then
  // places it.
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(clipDndKindType(track.kind));
  const onDragOver = (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    onHover(Math.max(0, floorB(beatAt(e.clientX))));
  };
  const onDrop = (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    onHover(null);
    const startBeat = Math.max(0, floorB(beatAt(e.clientX)));
    const draggedId = e.dataTransfer.getData(CLIP_DND_TYPE);
    if (draggedId && track.clips.some((clip) => clip.id === draggedId)) {
      placeClipAt(draggedId, startBeat); // same track: place the existing clip
      return;
    }
    // Cross-track: copy the dragged clip's content into this track, then place it.
    const content = getDraggedClip();
    if (!content || content.kind !== track.kind) return;
    const clipId = newClipId();
    const id = newPlacementId();
    dispatch({ type: "pasteClip", trackId: track.id, id: clipId, content });
    dispatch({
      type: "addPlacement",
      trackId: track.id,
      id,
      clipId,
      startBeat,
    });
    onSelect(track.id, { id, clipId, startBeat, offset: 0, length: 0 });
  };

  /**
   * One drag, three meanings: move the window, drag its end, or trim its start. All snap, all
   * coalesce into a single undo step.
   *
   * **Trimming the start is one command on purpose.** It moves three things at once - the
   * window's start, its offset into the clip so the content underneath does not slide, and its
   * length - and `movePlacement` plus `resizePlacement` coalesce under different keys, so
   * splitting it would cost an undo step per frame of the drag. Hence `startBeat` on
   * `resizePlacement`.
   */
  const beginPlacementDrag = (p: Placement, gesture: "move" | "start" | "end", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(track.id, p);
    const downBeat = beatAt(e.clientX);
    const origin = { startBeat: p.startBeat, length: p.length, offset: p.offset };
    const minLength = snapOn ? snapDiv : GRID;

    const onMove = (ev: PointerEvent) => {
      const delta = beatAt(ev.clientX) - downBeat;
      if (gesture === "move") {
        const startBeat = Math.max(0, snapB(origin.startBeat + delta));
        if (startBeat !== p.startBeat)
          dispatch({ type: "movePlacement", trackId: track.id, placementId: p.id, startBeat });
        return;
      }
      if (gesture === "end") {
        const length = Math.max(minLength, snapB(origin.length + delta));
        if (length !== p.length) dispatch({ type: "resizePlacement", trackId: track.id, placementId: p.id, length });
        return;
      }
      // Clamped against the window's own end, so trimming can shorten it but never invert it.
      const startBeat = Math.max(
        0,
        Math.min(snapB(origin.startBeat + delta), origin.startBeat + origin.length - minLength),
      );
      const shift = startBeat - origin.startBeat;
      if (startBeat !== p.startBeat)
        dispatch({
          type: "resizePlacement",
          trackId: track.id,
          placementId: p.id,
          startBeat,
          offset: origin.offset + shift,
          length: origin.length - shift,
        });
    };
    beginPointerDrag(onMove);
  };

  /**
   * A press on the block body. The right-edge grab zone is **mouse only**: a 7px target is not a
   * touch affordance, and on touch the selected clip's own handles do this job at finger size
   * (MOBILE-7). Same split as the roll's notes.
   */
  const onBlockDown = (p: Placement, e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isEdge = e.pointerType === "mouse" && rect.right - e.clientX <= RESIZE_PX;
    beginPlacementDrag(p, isEdge ? "end" : "move", e);
  };

  /** A clip's actions: on touch from its ⋮, with a mouse from a right-click (DAW-74). */
  const placementItems = (placement: Placement): MenuItem[] => {
    const remove = () => dispatch({ type: "removePlacement", trackId: track.id, placementId: placement.id });
    const clip = track.clips.find((candidate) => candidate.id === placement.clipId);
    return [
      ...(clip ? [clipColorMenu(track, clip, dispatch), { separator: true }] : []),
      { label: "Copy", onClick: () => onCopy(placement) },
      {
        label: "Cut",
        onClick: () => {
          onCopy(placement);
          remove();
        },
      },
      { label: "Duplicate", onClick: () => duplicatePlacement(placement) },
      { label: "Delete", danger: true, onClick: remove },
    ];
  };
  const { openAt, menu } = useContextMenu();

  /** Place a second window over the same clip, immediately after this one. */
  const duplicatePlacement = (p: Placement) => {
    const id = newPlacementId();
    dispatch({
      type: "addPlacement",
      trackId: track.id,
      id,
      clipId: p.clipId,
      startBeat: p.startBeat + p.length,
      length: p.length,
      offset: p.offset,
    });
    onSelect(track.id, { ...p, id, startBeat: p.startBeat + p.length });
  };

  // Double-click a block to split it at the cursor.
  const onBlockDouble = (p: Placement, e: React.MouseEvent) => {
    e.stopPropagation();
    const at = snapB(beatAt(e.clientX));
    if (at > p.startBeat && at < p.startBeat + p.length)
      dispatch({
        type: "splitPlacement",
        trackId: track.id,
        placementId: p.id,
        atBeat: at,
        newId: newPlacementId(),
      });
  };

  // Create a new empty clip sized to [start, start+length) and place it; the new
  // clip becomes active so the roll follows it. (Place an existing clip via the
  // clip rail, or copy/paste / drag-loop to repeat one.)
  const createClip = (start: number, length: number) => {
    if (track.kind !== "instrument") return;
    const clipId = newClipId();
    const id = newPlacementId();
    dispatch({
      type: "addClip",
      trackId: track.id,
      id: clipId,
      empty: true,
      lengthBeats: length,
    });
    dispatch({
      type: "addPlacement",
      trackId: track.id,
      id,
      clipId,
      startBeat: start,
      length,
    });
    onSelect(track.id, { id, clipId, startBeat: start, offset: 0, length });
  };

  /**
   * The marker drops on the tap's CLICK rather than its pointerup, and that is load-bearing. The
   * browser dispatches the click after pointerup, at the same point, to whatever is under it by
   * then - and the marker brings a kebab with it. Dropped on pointerup, the kebab rendered in time
   * to catch the click and opened its own menu, so the tap meant to open it closed it instead.
   * Dropped here, the click has already been delivered and nothing new is under the finger.
   */
  const pendingMark = useRef<number | null>(null);
  const onLaneClick = () => {
    if (pendingMark.current === null) return;
    onMark(track.id, pendingMark.current);
    pendingMark.current = null;
  };

  // Press on empty lane: a clean click drops a paste marker at that beat; a drag
  // sketches a new empty clip sized to the drag.
  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pendingMark.current = null; // a tap whose click never came (a scroll took it) drops nothing
    const downBeat = beatAt(e.clientX);
    const downX = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - downX) <= DRAG_THRESH) return;
      moved = true;
      const start = Math.max(0, floorB(Math.min(downBeat, beatAt(ev.clientX))));
      const end = snapB(Math.max(downBeat, beatAt(ev.clientX)));
      const length = Math.max(snapOn ? snapDiv : GRID, end - start);
      setDraft({
        left: beatToX(start, pxPerBeat),
        width: beatToX(length, pxPerBeat),
      });
    };
    beginPointerDrag(onMove, (ev) => {
      setDraft(null);
      if (!moved) {
        // A clean tap: the marker drops on the click that follows, not here - see `onLaneClick`.
        pendingMark.current = Math.max(0, floorB(downBeat));
        return;
      }
      // Drag: an empty clip sized to the drag.
      const start = Math.max(0, floorB(Math.min(downBeat, beatAt(ev.clientX))));
      const length = Math.max(snapOn ? snapDiv : GRID, snapB(Math.max(downBeat, beatAt(ev.clientX))) - start);
      createClip(start, length);
    });
  };

  /**
   * What a tap on empty lane space offers (MOBILE-17). Touch never fires HTML5 drag-and-drop, so
   * this menu is how a phone places a clip at all: tap a clip in the rail to make it active, tap
   * the lane, and place it. Paste and Create clip ride along, since they act at the same marker.
   */
  const markerMenuItems = (beat: number): MenuItem[] => {
    const active = track.clips.find((clip) => clip.id === track.activeClipId);
    const place: MenuItem[] = active
      ? [{ label: `Place ${active.name ?? "clip"} here`, onClick: () => placeClipAt(active.id, beat) }]
      : [];
    const create: MenuItem[] =
      track.kind === "instrument" ? [{ label: "Create clip", onClick: () => createClip(beat, beatsPerBar) }] : [];
    return [...place, { label: "Paste", disabled: !canPaste(), onClick: () => onPaste(beat) }, ...create];
  };

  const laneBg = [
    `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${pxPerBeat * beatsPerBar}px)`,
    `repeating-linear-gradient(90deg, var(--color-line-soft) 0 1px, transparent 1px ${pxPerBeat}px)`,
  ].join(", ");

  return (
    <div
      ref={ref}
      data-testid="lane"
      onPointerDown={onLaneDown}
      onClick={onLaneClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      // Empty lane space offers what a tap's marker does there, at the beat clicked.
      onContextMenu={(e) => {
        const beat = Math.max(0, floorB(beatAt(e.clientX)));
        openAt(e, () => markerMenuItems(beat));
      }}
      className={`${ROW} relative border-b border-line-soft cursor-copy`}
      style={{ width, background: laneBg }}
    >
      {track.placements.map((placement) => {
        const clip = track.clips.find((candidate) => candidate.id === placement.clipId);
        const selected = selection?.trackId === track.id && selection.id === placement.id;
        const color = clip?.color ?? track.color;
        return (
          <Block
            key={placement.id}
            name={clip?.name}
            color={color}
            creator={clip?.author}
            left={beatToX(placement.startBeat, pxPerBeat)}
            width={beatToX(placement.length, pxPerBeat)}
            selected={selected}
            onPointerDown={(e) => onBlockDown(placement, e)}
            onDoubleClick={(e) => onBlockDouble(placement, e)}
            onContextMenu={(e) => {
              onSelect(track.id, placement);
              openAt(e, placementItems(placement));
            }}
          >
            {clip && "store" in clip ? (
              <NoteMinis store={clip.store} placement={placement} pxPerBeat={pxPerBeat} color={color} />
            ) : clip && "fileId" in clip ? (
              <Waveform fileId={clip.fileId} gain={clip.gain} className="absolute inset-0 w-full h-full opacity-80" />
            ) : null}
          </Block>
        );
      })}
      {selectedPlacement && (
        <ObjectHandles
          name="clip"
          title="Clip"
          left={beatToX(selectedPlacement.startBeat, pxPerBeat)}
          right={beatToX(selectedPlacement.startBeat + selectedPlacement.length, pxPerBeat)}
          top={BLOCK_INSET_Y}
          height={ROW_PX - BLOCK_INSET_Y * 2}
          leadX={stickyHeader ? headerW : 0}
          leadY={RULER_H}
          // The lane starts after the track-header column, so its own pixels are that far into
          // the scroller's content.
          offsetX={headerW}
          scrollRef={scrollRef}
          onResize={(edge, e) => beginPlacementDrag(selectedPlacement, edge, e)}
          menuItems={placementItems(selectedPlacement)}
        />
      )}
      {menu}
      {draft && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded border border-dashed border-you bg-you/15 pointer-events-none"
          style={{ left: draft.left, width: Math.max(2, draft.width) }}
        />
      )}
      {dropBeat !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-you pointer-events-none"
          style={{ left: beatToX(dropBeat, pxPerBeat) }}
        />
      )}
      {markerBeat !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-strong pointer-events-none"
          style={{ left: beatToX(markerBeat, pxPerBeat) }}
          title="Paste marker"
        >
          <span className="absolute -top-0.5 -left-1 w-2 h-2 rotate-45 bg-strong" />
        </div>
      )}
      {markerBeat !== null && (
        <MarkerMenu left={beatToX(markerBeat, pxPerBeat)} items={() => markerMenuItems(markerBeat)} />
      )}
      <LaunchedClip track={track} dispatch={dispatch} />
    </div>
  );
}
