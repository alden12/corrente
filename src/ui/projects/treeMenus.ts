/**
 * The project tree's ⋯ menus (DAW-83), as `MenuItem` data: everything a row does beyond selecting,
 * folding, mute and solo. Moving is by menu until drag reorder (DAW-8.18) exists.
 */
import type { Dispatch } from "../../audio/commands/types";
import type { GroupMeta, TrackMeta } from "../../audio/project/types";
import { newGroupId, newTrackId } from "../../audio/commands/ids";
import { EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import { colorMenu } from "../deviceColor";
import type { MenuItem } from "../Menu";

/** A level, 0..1, set in place in the menu. */
const levelItem = (volume: number, set: (volume: number) => void): MenuItem => ({
  label: "Level",
  fader: {
    position: volume,
    onPosition: set,
    display: String(Math.round(volume * 100)),
    aria: { now: Math.round(volume * 100), min: 0, max: 100 },
  },
});

/** A group's name as the tree shows a path to it: "Keys › Textures". */
function groupPath(groups: GroupMeta[], group: GroupMeta): string {
  const parent = groups.find((each) => each.id === group.parentId);
  return parent ? `${groupPath(groups, parent)} › ${group.name}` : group.name;
}

/** The groups inside `groupId`, at any depth, and itself: where it can't be moved to. */
function selfAndInside(groups: GroupMeta[], groupId: string): Set<string> {
  const inside = groups.filter((group) => group.parentId === groupId).map((group) => group.id);
  return new Set([groupId, ...inside.flatMap((id) => [...selfAndInside(groups, id)])]);
}

export function trackMenu(track: TrackMeta, groups: GroupMeta[], dispatch: Dispatch, onRename: () => void): MenuItem[] {
  return [
    { label: "Rename", onClick: onRename },
    colorMenu(track.color, (color) => dispatch({ type: "setTrack", trackId: track.id, color })),
    levelItem(track.volume, (volume) => dispatch({ type: "setTrack", trackId: track.id, volume })),
    {
      label: "Move to group",
      submenu: groups.map((group) => ({
        label: groupPath(groups, group),
        checked: group.id === track.parentId,
        onClick: () => dispatch({ type: "moveTrack", trackId: track.id, groupId: group.id }),
      })),
    },
    { separator: true },
    { label: "Delete track", danger: true, onClick: () => dispatch({ type: "removeTrack", trackId: track.id }) },
  ];
}

export function groupMenu(group: GroupMeta, groups: GroupMeta[], dispatch: Dispatch, onRename: () => void): MenuItem[] {
  const unreachable = selfAndInside(groups, group.id);
  return [
    {
      label: "New MIDI track",
      onClick: () =>
        dispatch({ type: "createTrack", instrumentType: EMPTY_INSTRUMENT, id: newTrackId(), groupId: group.id }),
    },
    {
      label: "New audio track",
      onClick: () => dispatch({ type: "createAudioTrack", id: newTrackId(), groupId: group.id }),
    },
    {
      label: "New group inside",
      onClick: () => dispatch({ type: "createGroup", id: newGroupId(), parentId: group.id }),
    },
    { separator: true },
    { label: "Rename", onClick: onRename },
    levelItem(group.volume, (volume) => dispatch({ type: "setGroup", groupId: group.id, volume })),
    {
      label: "Move into",
      submenu: [
        {
          label: "Top level",
          checked: group.parentId === null,
          onClick: () => dispatch({ type: "moveGroup", groupId: group.id, parentId: null }),
        },
        ...groups
          .filter((each) => !unreachable.has(each.id))
          .map((each) => ({
            label: groupPath(groups, each),
            checked: each.id === group.parentId,
            onClick: () => dispatch({ type: "moveGroup", groupId: group.id, parentId: each.id }),
          })),
      ],
    },
    { separator: true },
    {
      label: "Delete group and its contents",
      danger: true,
      onClick: () => dispatch({ type: "removeGroup", groupId: group.id }),
    },
  ];
}
