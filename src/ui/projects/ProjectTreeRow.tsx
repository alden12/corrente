/**
 * One row of the project tree (DAW-83, canvas "Corrente Project Tree", version B): a group (fold
 * chevron, folder, name) or a track (an icon in its colour, name), indented with a guide per level,
 * then its clips across the song, then what is muted or soloed as a letter.
 *
 * Kept clean until it's needed: with a mouse, hovering a row (or tabbing into it) swaps the letter
 * for its mute, solo and ⋯ buttons. A touch has no hover, so on a phone the row swipes left to show
 * Mute and Solo behind it (`useSwipeActions`), and its ⋮ menu is always there at the end.
 */
import type { Dispatch } from "../../audio/commands/types";
import type { GroupMeta, TrackMeta } from "../../audio/project/types";
import type { ProjectStore } from "../../audio/project/projectStore";
import { InlineRename } from "../InlineRename";
import { Menu } from "../Menu";
import { MuteSolo } from "../MixerControls";
import { paletteAccent } from "../deviceColor";
import { deviceChain } from "./deviceChain";
import type { StripBlock, TreeRow } from "./overviewData";
import { groupMenu, trackMenu } from "./treeMenus";
import { useSwipeActions } from "./useSwipeActions";

/** What every row needs from the tree around it. */
export interface TreeContext {
  projectStore: ProjectStore;
  dispatch: Dispatch;
  groups: GroupMeta[];
  selectedId: string | null;
  /** The selected track's group: the guide down its contents is the lit one, as VS Code's is. */
  activeGroupId: string | null;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  swipedId: string | null;
  setSwipedId: (id: string | null) => void;
  onChoose: (track: TrackMeta) => void;
}

/** The actions behind a swiped row: two 64px buttons. */
const SWIPE_WIDTH = 128;

/** The indent per level and where its guide falls, through CSS variables so a phone can widen it. */
const indentStyle = (depth: number) => ({ paddingLeft: `calc(6px + ${depth} * var(--tree-indent))` });
const guideLeft = (level: number) => `calc(6px + ${level} * var(--tree-indent) + 8px)`;

function Strip({ blocks, faded }: { blocks: StripBlock[]; faded: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block h-3 rounded-[3px] overflow-hidden ${blocks.length > 0 ? "bg-ground" : ""} ${
        faded ? "opacity-35" : ""
      }`}
    >
      {blocks.map((block, index) => (
        <span
          key={index}
          className="absolute top-[3px] bottom-[3px] rounded-[1px]"
          style={{
            left: `${block.left}%`,
            width: `max(2px, calc(${block.width}% - 1px))`,
            background: faded ? "var(--color-faint)" : paletteAccent(block.color),
          }}
        />
      ))}
    </span>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    className={`w-4 h-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
  >
    <path d="M5 6l3 3 3-3" />
  </svg>
);

const Folder = () => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    className="w-4 h-4 shrink-0 text-muted"
  >
    <path d="M1.5 4v8.5h13V5.5H7.2L5.8 4z" />
  </svg>
);

/** A MIDI track's keys, or an audio track's waveform, in the track's colour. */
function TrackIcon({ track }: { track: TrackMeta }) {
  const color = track.muted ? "var(--color-faint)" : paletteAccent(track.color);
  return track.kind === "audio" ? (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      className="w-4 h-4 shrink-0"
    >
      <path d="M2 8h1M5 5v6M8 2.5v11M11 5.5v5M13.5 8h.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="w-4 h-4 shrink-0">
      <rect x="2" y="3" width="12" height="10" rx="2" fill={color} />
      <path d="M6 3v6M10 3v6" stroke="var(--color-panel)" strokeWidth="1.4" />
    </svg>
  );
}

/** The swiped row's actions: Mute and Solo. */
function SwipedActions({
  name,
  muted,
  solo,
  onMute,
  onSolo,
}: {
  name: string;
  muted: boolean;
  solo: boolean;
  onMute: () => void;
  onSolo: () => void;
}) {
  const action = "w-16 h-full flex items-center justify-center text-[13px] font-semibold text-strong cursor-pointer";
  return (
    <div className="absolute inset-y-0 right-0 flex" style={{ width: SWIPE_WIDTH }}>
      <button
        type="button"
        aria-label={`${muted ? "Unmute" : "Mute"} ${name}`}
        aria-pressed={muted}
        onClick={onMute}
        className={`${action} bg-hot/60`}
      >
        {muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        aria-label={`${solo ? "Unsolo" : "Solo"} ${name}`}
        aria-pressed={solo}
        onClick={onSolo}
        className={`${action} bg-warn/45`}
      >
        {solo ? "Unsolo" : "Solo"}
      </button>
    </div>
  );
}

export function ProjectTreeRow({ row, context }: { row: TreeRow; context: TreeContext }) {
  const isGroup = row.kind === "group";
  const item = isGroup ? row.group : row.track;
  const id = item.id;
  const swipe = useSwipeActions(id, context.swipedId, context.setSwipedId, SWIPE_WIDTH);
  const renaming = context.renamingId === id;
  const selected = !isGroup && id === context.selectedId;

  const set = (change: { muted?: boolean; solo?: boolean; name?: string }) =>
    isGroup
      ? context.dispatch({ type: "setGroup", groupId: id, ...change })
      : context.dispatch({ type: "setTrack", trackId: id, ...change });
  const onMute = () => set({ muted: !item.muted });
  const onSolo = () => set({ solo: !item.solo });
  const startRename = () => context.setRenamingId(id);
  const menu = () =>
    isGroup
      ? groupMenu(row.group, context.groups, context.dispatch, startRename)
      : trackMenu(row.track, context.groups, context.dispatch, startRename);
  // A touch's menu leads with mute and solo too, for whoever hasn't found the swipe (2026-11-01).
  const touchMenu = () => [
    { label: item.muted ? "Unmute" : "Mute", onClick: onMute },
    { label: item.solo ? "Unsolo" : "Solo", onClick: onSolo },
    { separator: true },
    ...menu(),
  ];

  const name = renaming ? (
    <InlineRename
      value={item.name}
      startEditing
      onCommit={(next) => set({ name: next })}
      onDone={() => context.setRenamingId(null)}
      className="flex-1 min-w-0 text-[13px] pointer-coarse:text-[15px] text-strong"
    />
  ) : null;

  const lead = isGroup
    ? (name && (
        <span className="flex items-center gap-1.5 min-w-0">
          <Chevron open={!row.folded} />
          <Folder />
          {name}
        </span>
      )) || (
        <button
          type="button"
          data-testid="tree-group"
          aria-expanded={!row.folded}
          onClick={() => context.projectStore.setGroupCollapsed(id, !row.folded)}
          onDoubleClick={startRename}
          className="flex items-center gap-1.5 min-w-0 h-full text-left cursor-pointer"
        >
          <Chevron open={!row.folded} />
          <Folder />
          <span className="truncate text-[13px] pointer-coarse:text-[15px] font-semibold text-strong">
            {row.group.name}
          </span>
          {row.folded && <span className="font-mono text-[10px] text-faint">{row.trackCount}</span>}
        </button>
      )
    : (name && (
        <span className="flex items-center gap-1.5 min-w-0 pl-4">
          <TrackIcon track={row.track} />
          {name}
        </span>
      )) || (
        <button
          type="button"
          data-testid="tree-track"
          aria-current={selected ? "true" : undefined}
          title={`${row.track.name}: ${deviceChain(row.track).join(" → ")}`}
          onClick={() => context.onChoose(row.track)}
          onDoubleClick={startRename}
          className="flex items-center gap-1.5 min-w-0 h-full pl-4 text-left cursor-pointer"
        >
          <TrackIcon track={row.track} />
          <span
            className={`truncate text-[13px] pointer-coarse:text-[15px] ${
              selected ? "text-strong" : row.track.muted ? "text-faint" : "text-ink"
            }`}
          >
            {row.track.name}
          </span>
        </button>
      );

  const ground = selected
    ? "bg-[color-mix(in_oklab,var(--color-you)_14%,var(--color-panel))] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-you)_55%,transparent)] pointer-coarse:shadow-[inset_3px_0_0_var(--color-you)]"
    : swipe.offset < 0
      ? "bg-panel"
      : "hover:bg-[color-mix(in_oklab,var(--color-you)_6%,var(--color-panel))]";

  return (
    <li className="relative overflow-hidden" aria-label={item.name}>
      {swipe.offset < 0 && (
        <SwipedActions name={item.name} muted={item.muted} solo={item.solo} onMute={onMute} onSolo={onSolo} />
      )}
      <div
        {...swipe.handlers}
        style={{ transform: swipe.offset ? `translateX(${swipe.offset}px)` : undefined, ...indentStyle(row.depth) }}
        className={`group/row relative grid grid-cols-[minmax(0,1fr)_84px_64px] pointer-coarse:grid-cols-[minmax(0,1fr)_72px_28px_40px] gap-2 items-center h-[26px] pointer-coarse:h-12 pr-2 pointer-coarse:pr-0 touch-pan-y ${ground} ${
          swipe.dragging ? "" : "transition-transform"
        }`}
      >
        {row.ancestors.map((ancestor, level) => (
          <span
            key={ancestor}
            aria-hidden="true"
            className={`absolute inset-y-0 w-px ${ancestor === context.activeGroupId ? "bg-muted/60" : "bg-line"}`}
            style={{ left: guideLeft(level) }}
          />
        ))}
        {lead}
        <Strip blocks={row.strip} faded={item.muted} />
        <span className="relative flex items-center justify-end h-full">
          {/* Both letters when both: a muted, soloed track plays nothing, and the row should say why.
              With a mouse each sits just where its button comes on hover: the same slots, unbordered. */}
          <span
            aria-hidden="true"
            className="flex items-center gap-0.5 font-mono text-[10px] font-semibold pointer-coarse:hidden group-hover/row:invisible group-focus-within/row:invisible"
          >
            <span className="flex border border-transparent">
              <span className="w-5 h-5 flex items-center justify-center text-hot">{item.muted ? "M" : ""}</span>
              <span className="w-5 h-5 flex items-center justify-center text-warn">{item.solo ? "S" : ""}</span>
            </span>
            <span className="w-5" />
          </span>
          <span
            aria-hidden="true"
            className="hidden pointer-coarse:flex gap-1 font-mono text-[11px] font-semibold pr-1"
          >
            {item.muted && <span className="text-hot">M</span>}
            {item.solo && <span className="text-warn">S</span>}
          </span>
          {/* A mouse's actions, there but unseen until the row is hovered or tabbed into. */}
          <span className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:hidden">
            <MuteSolo
              size="tree"
              name={item.name}
              muted={item.muted}
              solo={item.solo}
              onMute={onMute}
              onSolo={onSolo}
            />
            <Menu
              label={`Actions for ${item.name}`}
              items={menu}
              trigger="⋯"
              triggerClassName="w-5 h-5 text-[15px] leading-none text-muted hover:text-ink cursor-pointer"
            />
          </span>
        </span>
        {/* A touch's menu, always at hand: no hover to bring it up. */}
        <span className="hidden pointer-coarse:flex justify-end">
          <Menu
            label={`Actions for ${item.name}`}
            items={touchMenu}
            triggerClassName="w-10 h-12 flex items-center justify-center text-[20px] leading-none text-muted cursor-pointer"
          />
        </span>
      </div>
    </li>
  );
}
