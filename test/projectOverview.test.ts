import { describe, expect, it } from "vitest";
import type { GroupMeta, TrackMeta } from "../src/audio/project/types";
import { deviceChain } from "../src/ui/projects/deviceChain";
import { clipStrip, formatLength, groupTree, treeRows, type GroupNode } from "../src/ui/projects/overviewData";

const device = (id: string, type: string, bypassed = false) => ({ id, type, bypassed });

/** Only the fields these helpers read; the rest of a track does not matter to them. */
const track = (id: string, parentId: string, extra: Partial<TrackMeta> = {}) =>
  ({
    id,
    name: id,
    parentId,
    kind: "instrument",
    instrumentType: "subtractive",
    midiDevices: [],
    effects: [],
    ...extra,
  }) as TrackMeta;
const group = (id: string, parentId: string | null, collapsed = false) =>
  ({ id, name: id, parentId, collapsed }) as GroupMeta;

describe("deviceChain", () => {
  it("reads in signal order: MIDI devices, the instrument, then effects, skipping bypassed ones", () => {
    const keys = track("Keys", "g", {
      midiDevices: [device("m1", "arpeggiator"), device("m2", "octavator", true)],
      effects: [device("e1", "delay"), device("e2", "reverb")],
    } as Partial<TrackMeta>);
    expect(deviceChain(keys)).toEqual(["Arpeggiator", "Subtractive", "Delay", "Reverb"]);
  });

  it("names an audio track's source and an empty instrument", () => {
    const audio = { ...track("Vox", "g"), kind: "audio", effects: [device("e1", "delay")] } as TrackMeta;
    expect(deviceChain(audio)).toEqual(["Audio", "Delay"]);
    expect(deviceChain(track("Empty", "g", { instrumentType: "none" } as Partial<TrackMeta>))).toEqual([
      "No instrument",
    ]);
  });
});

describe("groupTree", () => {
  const groups = [group("Rhythm", null), group("Perc", "Rhythm"), group("Keys", null)];
  const tracks = [track("Drums", "Rhythm"), track("Shaker", "Perc"), track("Lead", "Keys")];
  const shape = (nodes: GroupNode[]): unknown =>
    nodes.map((node) => [node.group.name, node.tracks.map((each) => each.name), shape(node.children)]);

  it("nests groups by parent, each with its own tracks", () => {
    expect(shape(groupTree(groups, tracks, "").nodes)).toEqual([
      ["Rhythm", ["Drums"], [["Perc", ["Shaker"], []]]],
      ["Keys", ["Lead"], []],
    ]);
  });

  it("filters to the groups that lead to a match", () => {
    expect(shape(groupTree(groups, tracks, "shak").nodes)).toEqual([["Rhythm", [], [["Perc", ["Shaker"], []]]]]);
    expect(groupTree(groups, tracks, "nothing").nodes).toEqual([]);
  });

  it("keeps an empty group when not filtering, and returns tracks with no group", () => {
    const { nodes, orphans } = groupTree([group("Empty", null)], [track("Stray", "gone")], "");
    expect(shape(nodes)).toEqual([["Empty", [], []]]);
    expect(orphans.map((each) => each.name)).toEqual(["Stray"]);
  });
});

describe("clipStrip and treeRows", () => {
  // Each track's clips: "a" plain, "b" with a colour of its own.
  const placed = (
    id: string,
    parentId: string,
    color: string,
    placements: { clipId: string; startBeat: number; length: number }[],
  ) =>
    track(id, parentId, {
      color,
      clips: [{ id: "a" }, { id: "b", color: "pink" }],
      placements,
    } as unknown as Partial<TrackMeta>);
  const drums = placed("Drums", "Rhythm", "red", [
    { clipId: "a", startBeat: 0, length: 16 },
    { clipId: "b", startBeat: 32, length: 16 },
  ]);
  const bass = placed("Bass", "Rhythm", "blue", [{ clipId: "a", startBeat: 16, length: 16 }]);
  const shaker = placed("Shaker", "Perc", "lime", [{ clipId: "a", startBeat: 0, length: 8 }]);

  it("lays clips out across the song, each in its clip's colour", () => {
    expect(clipStrip([drums, bass], 64)).toEqual([
      { left: 0, width: 25, color: "red" },
      { left: 50, width: 25, color: "pink" },
      { left: 25, width: 25, color: "blue" },
    ]);
  });

  const shape = (rows: ReturnType<typeof treeRows>) =>
    rows.map((row) =>
      row.kind === "group"
        ? `${"  ".repeat(row.depth)}${row.group.name}${row.folded ? ` (folded, ${row.trackCount})` : ""}`
        : `${"  ".repeat(row.depth)}${row.track.name}`,
    );

  it("lists groups, the groups inside them, then their tracks, each a level deeper", () => {
    const rows = treeRows([group("Rhythm", null), group("Perc", "Rhythm")], [drums, bass, shaker], "", 64);
    expect(shape(rows)).toEqual(["Rhythm", "  Perc", "    Shaker", "  Drums", "  Bass"]);
    expect(rows[2].ancestors).toEqual(["Rhythm", "Perc"]);
    // An open group leaves its clips to its tracks' rows.
    expect(rows[0].strip).toEqual([]);
  });

  it("folds a group down to one row whose strip holds every clip inside it", () => {
    const rows = treeRows([group("Rhythm", null, true), group("Perc", "Rhythm")], [drums, bass, shaker], "", 64);
    expect(shape(rows)).toEqual(["Rhythm (folded, 3)"]);
    expect(rows[0].strip).toHaveLength(4);
  });

  it("opens every group while filtering, so a match is never folded away", () => {
    const rows = treeRows(
      [group("Rhythm", null, true), group("Perc", "Rhythm", true)],
      [drums, bass, shaker],
      "shak",
      64,
    );
    expect(shape(rows)).toEqual(["Rhythm", "  Perc", "    Shaker"]);
  });

  it("puts a track whose group is missing at the top level", () => {
    const stray = track("Stray", "gone", { placements: [] } as Partial<TrackMeta>);
    expect(shape(treeRows([], [stray], "", 64))).toEqual(["Stray"]);
  });
});

describe("formatLength", () => {
  it("turns beats at a tempo into minutes and seconds", () => {
    expect(formatLength(64, 120)).toBe("0:32");
    expect(formatLength(330, 118)).toBe("2:48");
  });
});
