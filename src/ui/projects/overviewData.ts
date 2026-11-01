/** The pure halves of the project page (`ProjectOverview`, `ProjectTree`), kept apart for tests. */
import type { DeviceColor } from "../../audio/deviceColors";
import type { GroupMeta, TrackMeta } from "../../audio/project/types";
import { nameMatches } from "./nameMatches";

/** `2:48`: a length in beats at a tempo, as minutes and seconds. */
export function formatLength(beats: number, tempoBpm: number): string {
  const seconds = Math.round((beats * 60) / Math.max(1, tempoBpm));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A group in the tree: its own tracks, then the groups inside it. */
export interface GroupNode {
  group: GroupMeta;
  tracks: TrackMeta[];
  children: GroupNode[];
}

/**
 * The group tree (parentId links) with each group's tracks. While filtering, only matching tracks
 * are kept, and a group with none left anywhere under it drops out, so the groups that remain are
 * the way to every match. Tracks whose group is missing come back as `orphans`, so none are lost.
 */
export function groupTree(
  groups: GroupMeta[],
  tracks: TrackMeta[],
  filter: string,
): { nodes: GroupNode[]; orphans: TrackMeta[] } {
  const filtering = filter.trim() !== "";
  const shown = tracks.filter((track) => nameMatches(track.name, filter));
  const build = (parentId: string | null): GroupNode[] =>
    groups
      .filter((group) => group.parentId === parentId)
      .map((group) => ({
        group,
        tracks: shown.filter((track) => track.parentId === group.id),
        children: build(group.id),
      }))
      .filter((node) => !filtering || node.tracks.length > 0 || node.children.length > 0);
  const groupIds = new Set(groups.map((group) => group.id));
  return { nodes: build(null), orphans: shown.filter((track) => !groupIds.has(track.parentId)) };
}

/** Every track under a group, its own and those of the groups inside it. */
const allTracks = (node: GroupNode): TrackMeta[] => [...node.tracks, ...node.children.flatMap(allTracks)];

/** One clip on a row's strip: where it sits across the song, in percent, and its colour. */
export interface StripBlock {
  left: number;
  width: number;
  /** Its clip's colour (DAW-47): the clip's own, else its track's. */
  color: DeviceColor;
}

/** Some tracks' clips in one lane, scaled to the whole song. */
export function clipStrip(tracks: TrackMeta[], spanBeats: number): StripBlock[] {
  const span = Math.max(1, spanBeats);
  return tracks.flatMap((track) =>
    track.placements.map((placement) => ({
      left: (placement.startBeat / span) * 100,
      width: (placement.length / span) * 100,
      color: track.clips.find((clip) => clip.id === placement.clipId)?.color ?? track.color,
    })),
  );
}

/** Where a row sits in the tree: how deep, and the groups it is inside, outermost first. */
interface Placed {
  depth: number;
  ancestors: string[];
}

/** One row of the project tree (DAW-83): a group or a track, with the clip strip it shows. */
export type TreeRow =
  | (Placed & { kind: "group"; group: GroupMeta; folded: boolean; trackCount: number; strip: StripBlock[] })
  | (Placed & { kind: "track"; track: TrackMeta; strip: StripBlock[] });

/**
 * The tree as rows, depth first: each group, then the groups inside it, then its tracks, as the
 * arrangement orders them. A folded group hides what is inside it and shows all of their clips on
 * its own strip instead; an open one has none, its tracks showing their own. While filtering
 * nothing is folded, so every match shows.
 */
export function treeRows(groups: GroupMeta[], tracks: TrackMeta[], filter: string, spanBeats: number): TreeRow[] {
  const filtering = filter.trim() !== "";
  const { nodes, orphans } = groupTree(groups, tracks, filter);
  const walk = (node: GroupNode, ancestors: string[]): TreeRow[] => {
    const folded = node.group.collapsed && !filtering;
    const inside = [...ancestors, node.group.id];
    const row: TreeRow = {
      kind: "group",
      group: node.group,
      depth: ancestors.length,
      ancestors,
      folded,
      trackCount: allTracks(node).length,
      strip: folded ? clipStrip(allTracks(node), spanBeats) : [],
    };
    if (folded) return [row];
    return [
      row,
      ...node.children.flatMap((child) => walk(child, inside)),
      ...node.tracks.map(
        (track): TreeRow => ({
          kind: "track",
          track,
          depth: inside.length,
          ancestors: inside,
          strip: clipStrip([track], spanBeats),
        }),
      ),
    ];
  };
  return [
    ...nodes.flatMap((node) => walk(node, [])),
    ...orphans.map(
      (track): TreeRow => ({ kind: "track", track, depth: 0, ancestors: [], strip: clipStrip([track], spanBeats) }),
    ),
  ];
}
