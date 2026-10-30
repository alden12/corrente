/**
 * One group on the project page (MOBILE-19.3, board "Chosen - Group cards with track rows inside"):
 * a card with the group's name, a one-line summary, group mute / solo and a strip of its tracks'
 * clips across the song. Open, it lists its tracks as rows (lane colour, name, device chain, mute,
 * solo, level), then the groups inside it as cards of their own, then "+ Track in <group>".
 *
 * The app cannot nest groups yet (Add group makes a top-level one), but a project can hold them
 * (the agent's `create_group` takes a parent), so the cards nest rather than assuming one level.
 */
import type { Dispatch } from "../../audio/commands/types";
import type { GroupMeta, TrackMeta } from "../../audio/project/types";
import { newTrackId } from "../../audio/commands/ids";
import { EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import { Fader, MuteSolo } from "../MixerControls";
import { Menu } from "../Menu";
import { paletteAccent } from "../deviceColor";
import { deviceChain } from "./deviceChain";
import { groupStrip, groupSummary, STRIP_LANES, type GroupNode } from "./overviewData";

/** What every card needs from the list around it. */
export interface CardContext {
  dispatch: Dispatch;
  selectedId: string | null;
  /** A track's position in the project, which picks its colour (as in the project thumbnail). */
  spanBeats: number;
  /** The cards opened on this device; the rest start, and stay, closed. */
  opened: Set<string>;
  onToggle: (groupId: string) => void;
  /** Filtering opens every card, so no match is hidden behind a closed one. */
  filtering: boolean;
  onChoose: (track: TrackMeta) => void;
}

export function TrackRow({ track, context }: { track: TrackMeta; context: CardContext }) {
  const selected = track.id === context.selectedId;
  const setTrack = (change: { muted?: boolean; solo?: boolean; volume?: number }) =>
    context.dispatch({ type: "setTrack", trackId: track.id, ...change });
  return (
    <li
      className={`grid grid-cols-[4px_minmax(0,1fr)_auto] @[17rem]:grid-cols-[4px_minmax(0,1fr)_auto_56px] items-center gap-2.5 min-h-14 pl-3 pr-3 border-t border-line/60 ${
        selected ? "bg-you/10" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className="h-9 rounded-[2px]"
        style={{ background: track.muted ? "var(--color-faint)" : paletteAccent(track.color) }}
      />
      <button
        type="button"
        data-testid="tree-track"
        aria-current={selected ? "true" : undefined}
        onClick={() => context.onChoose(track)}
        className="min-w-0 py-2 text-left cursor-pointer"
      >
        <span className={`block truncate text-[14px] font-medium ${selected ? "text-strong" : "text-ink"}`}>
          {track.name}
        </span>
        <span className="block truncate mt-0.5 font-mono text-[10px] tracking-wide uppercase text-muted">
          {deviceChain(track).join(" → ")}
        </span>
      </button>
      <MuteSolo
        size="row"
        name={track.name}
        muted={track.muted}
        solo={track.solo}
        onMute={() => setTrack({ muted: !track.muted })}
        onSolo={() => setTrack({ solo: !track.solo })}
      />
      {/* The level: hidden in a narrow column, where the name needs the room more. */}
      <span className="hidden @[17rem]:block">
        <Fader
          value={track.volume}
          title={`${track.name} level`}
          width={56}
          onChange={(volume) => setTrack({ volume })}
        />
      </span>
    </li>
  );
}

/** The group's clips across the whole song, one thin lane per track, each clip in its colour. */
function ClipStrip({ node, context }: { node: GroupNode; context: CardContext }) {
  const lanes = Math.min(STRIP_LANES, Math.max(1, node.tracks.length));
  return (
    <span aria-hidden="true" className="relative block h-7.5 mx-3 mb-2.5 rounded-[5px] bg-ground overflow-hidden">
      {groupStrip(node, context.spanBeats).map((block, index) => (
        <span
          key={index}
          className="absolute h-1.25 rounded-[1px]"
          style={{
            left: `${block.left}%`,
            width: `max(2px, ${block.width}%)`,
            top: `${4 + block.lane * (22 / lanes)}px`,
            background: node.group.muted ? "var(--color-faint)" : paletteAccent(block.color),
          }}
        />
      ))}
    </span>
  );
}

export function GroupCard({ node, context }: { node: GroupNode; context: CardContext }) {
  const group: GroupMeta = node.group;
  const open = context.filtering || context.opened.has(group.id);
  const setGroup = (change: { muted?: boolean; solo?: boolean }) =>
    context.dispatch({ type: "setGroup", groupId: group.id, ...change });
  return (
    <section aria-label={group.name} className="rounded-xl border border-line bg-stage overflow-hidden">
      <div className="flex items-center gap-1.5 pl-3 pr-2.5 pt-2.5 pb-2">
        <button
          type="button"
          onClick={() => context.onToggle(group.id)}
          aria-expanded={open}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className={`w-4 h-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          >
            <path d="M3 6l5 5 5-5" />
          </svg>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-strong">{group.name}</span>
            <span className="block truncate text-[12px] text-muted">{groupSummary(node)}</span>
          </span>
        </button>
        <MuteSolo
          size="row"
          name={group.name}
          muted={group.muted}
          solo={group.solo}
          onMute={() => setGroup({ muted: !group.muted })}
          onSolo={() => setGroup({ solo: !group.solo })}
        />
      </div>
      <ClipStrip node={node} context={context} />
      {open && (
        <>
          {node.tracks.length > 0 && (
            <ul aria-label={`Tracks in ${group.name}`}>
              {node.tracks.map((track) => (
                <TrackRow key={track.id} track={track} context={context} />
              ))}
            </ul>
          )}
          {node.children.length > 0 && (
            <div className="flex flex-col gap-2.5 px-2.5 pb-2.5">
              {node.children.map((child) => (
                <GroupCard key={child.group.id} node={child} context={context} />
              ))}
            </div>
          )}
          <Menu
            align="left"
            label={`Add a track to ${group.name}`}
            trigger={`+ Track in ${group.name}`}
            triggerClassName="block w-full px-3 py-3 border-t border-line/60 text-left text-[13px] text-muted hover:text-ink cursor-pointer"
            items={[
              {
                label: "New MIDI track",
                onClick: () =>
                  context.dispatch({
                    type: "createTrack",
                    instrumentType: EMPTY_INSTRUMENT,
                    id: newTrackId(),
                    groupId: group.id,
                  }),
              },
              {
                label: "New audio track",
                onClick: () => context.dispatch({ type: "createAudioTrack", id: newTrackId(), groupId: group.id }),
              },
            ]}
          />
        </>
      )}
    </section>
  );
}
