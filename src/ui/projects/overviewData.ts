/** The pure halves of the project page (`ProjectOverview`, `TrackList`), kept apart for tests. */
import type { GroupMeta, TrackMeta } from "../../audio/project/types";
import { nameMatches } from "./nameMatches";

/** `2:48`: a length in beats at a tempo, as minutes and seconds. */
export function formatLength(beats: number, tempoBpm: number): string {
  const seconds = Math.round((beats * 60) / Math.max(1, tempoBpm));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A group card's contents: its own tracks, then the groups inside it. */
export interface GroupNode {
  group: GroupMeta;
  tracks: TrackMeta[];
  children: GroupNode[];
}

/**
 * The group tree (parentId links) with each group's tracks. While filtering, only matching tracks
 * are kept, and a group with none left anywhere under it drops out, so the cards that remain are
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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Every track in a card, its own and those of the groups inside it. */
const allTracks = (node: GroupNode): TrackMeta[] => [...node.tracks, ...node.children.flatMap(allTracks)];

/** "Drums, Bass · 2 tracks, 1 group · 9 clips": what a group card holds, in one line. */
export function groupSummary(node: GroupNode): string {
  if (node.tracks.length === 0 && node.children.length === 0) return "Empty";
  const names = node.tracks.map((track) => track.name);
  const named = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  const counts = [
    plural(node.tracks.length, "track"),
    ...(node.children.length > 0 ? [plural(node.children.length, "group")] : []),
  ].join(", ");
  const clips = allTracks(node).reduce((sum, track) => sum + track.placements.length, 0);
  return [named, counts, plural(clips, "clip")].filter(Boolean).join(" · ");
}

/** One clip in a card's strip: which lane, and where it sits across the song, in percent. */
export interface StripBlock {
  lane: number;
  left: number;
  width: number;
}

/** Most lanes a card's strip draws, so a big group stays a strip rather than a block. */
export const STRIP_LANES = 4;

/** A group's own tracks' clips as a strip, one lane per track, scaled to the whole song. */
export function groupStrip(node: GroupNode, spanBeats: number): StripBlock[] {
  const span = Math.max(1, spanBeats);
  return node.tracks.slice(0, STRIP_LANES).flatMap((track, lane) =>
    track.placements.map((placement) => ({
      lane,
      left: (placement.startBeat / span) * 100,
      width: (placement.length / span) * 100,
    })),
  );
}
