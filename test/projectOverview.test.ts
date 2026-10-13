import { describe, expect, it } from "vitest";
import type { GroupMeta, TrackMeta } from "../src/audio/project/types";
import { deviceChain } from "../src/ui/projects/deviceChain";
import { formatLength, groupStrip, groupSummary, groupTree, type GroupNode } from "../src/ui/projects/overviewData";

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
const group = (id: string, parentId: string | null) => ({ id, name: id, parentId }) as GroupMeta;

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

describe("groupSummary and groupStrip", () => {
  const placed = (id: string, placements: { startBeat: number; length: number }[]) =>
    track(id, "g", { placements } as unknown as Partial<TrackMeta>);
  const node: GroupNode = {
    group: group("Rhythm", null),
    tracks: [
      placed("Drums", [
        { startBeat: 0, length: 16 },
        { startBeat: 32, length: 16 },
      ]),
      placed("Bass", [{ startBeat: 16, length: 16 }]),
    ],
    children: [
      { group: group("Perc", "Rhythm"), tracks: [placed("Shaker", [{ startBeat: 0, length: 8 }])], children: [] },
    ],
  };

  it("names the tracks and counts tracks, groups and clips (the inner groups' clips too)", () => {
    expect(groupSummary(node)).toBe("Drums, Bass · 2 tracks, 1 group · 4 clips");
    expect(groupSummary({ group: group("Empty", null), tracks: [], children: [] })).toBe("Empty");
  });

  it("lays the group's own clips out across the song, a lane per track", () => {
    expect(groupStrip(node, 64)).toEqual([
      { lane: 0, left: 0, width: 25 },
      { lane: 0, left: 50, width: 25 },
      { lane: 1, left: 25, width: 25 },
    ]);
  });
});

describe("formatLength", () => {
  it("turns beats at a tempo into minutes and seconds", () => {
    expect(formatLength(64, 120)).toBe("0:32");
    expect(formatLength(330, 118)).toBe("2:48");
  });
});
