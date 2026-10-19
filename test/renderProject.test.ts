import { describe, expect, it } from "vitest";
import { renderProject, type ProjectRender } from "../src/audio/render/renderProject";
import { renderDevice, type Rendered } from "../src/audio/render/renderDevice";
import { nodeRenderSetup } from "../server/render/nodeRender";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";

/** A project of one bar at 120 bpm (a beat is half a second), with no tracks yet. */
const project = () => {
  const store = new ProjectStore(false);
  store.setTempo(120);
  store.setLength(4);
  return store;
};

/** A track playing `notes` (beats), in the main group. */
const trackWith = (store: ProjectStore, type: string, notes: { pitch: number; start: number; length: number }[]) => {
  const track = store.addTrack(type) as InstrumentTrack;
  notes.forEach((note) => track.clips[0].store.addNote({ ...note, velocity: 0.8 }));
  return track;
};

const peakOf = ({ channels }: Rendered, from = 0, to = Infinity) =>
  channels.reduce(
    (most, channel) =>
      channel
        .subarray(Math.floor(from), Math.min(channel.length, to))
        .reduce((peak, sample) => Math.max(peak, Math.abs(sample)), most),
    0,
  );
const render = (store: ProjectStore) => renderProject(store, nodeRenderSetup(), { tailSec: 1 });

describe("renderProject (AGENT-4.9 part 2): the song, on the engine, in Node", () => {
  it("plays a track exactly as the device plays alone", async () => {
    const store = project();
    trackWith(store, "subtractive", [{ pitch: 60, start: 1, length: 1 }]);
    const song = await render(store);
    const alone = await renderDevice(
      { instrument: { type: "subtractive" } },
      { kind: "notes", notes: [{ pitch: 60, start: 0.5, length: 0.5 }] },
      song.channels[0].length / song.sampleRate,
      nodeRenderSetup(),
    );
    // Same plan, same notes, through the track's and the main group's default volume (0.8 each), and
    // under the soft clip's knee.
    const mix = 0.8 * 0.8;
    expect(peakOf(alone)).toBeLessThan(0.9);
    song.channels[0].forEach((sample, index) => expect(sample).toBeCloseTo(alone.channels[0][index] * mix, 5));
    expect(song.omitted).toEqual([]);
  });

  it("starts each note on its beat", async () => {
    const store = project();
    trackWith(store, "subtractive", [{ pitch: 60, start: 1, length: 0.5 }]);
    const song = await render(store);
    const first = song.channels[0].findIndex((sample) => sample !== 0);
    expect(first).toBeGreaterThanOrEqual(0.5 * song.sampleRate);
    expect(first).toBeLessThan(0.5 * song.sampleRate + 8);
  });

  it("follows volume, mute and solo", async () => {
    const store = project();
    const lead = trackWith(store, "subtractive", [{ pitch: 72, start: 0, length: 2 }]);
    const bass = trackWith(store, "subtractive", [{ pitch: 48, start: 0, length: 2 }]);
    const both = await render(store);

    store.setMuted(bass.id, true);
    const leadOnly = await render(store);
    store.setMuted(bass.id, false);
    store.setSolo(lead.id, true);
    const soloed = await render(store);
    expect(Array.from(soloed.channels[0])).toEqual(Array.from(leadOnly.channels[0]));
    expect(peakOf(leadOnly)).toBeLessThan(peakOf(both));

    store.setSolo(lead.id, false);
    store.setMuted(bass.id, true);
    store.setVolume(lead.id, 0.5);
    const half = await render(store);
    // From the default 0.8 to 0.5.
    expect(peakOf(half)).toBeCloseTo((peakOf(leadOnly) * 0.5) / 0.8, 5);
  });

  it("plays a group's effects on what its tracks send it", async () => {
    const store = project();
    const track = trackWith(store, "subtractive", [{ pitch: 60, start: 0, length: 0.5 }]);
    const dry = await render(store);
    store.addEffect(track.parentId!, "reverb");
    const wet = await render(store);
    // After the note and its release, only the group's reverb is still sounding.
    const tail = (song: ProjectRender) => peakOf(song, 1.5 * song.sampleRate);
    expect(tail(wet)).toBeGreaterThan(tail(dry) * 10);

    store.setGroupMuted(track.parentId!, true);
    expect(peakOf(await render(store))).toBe(0);
  });

  it("names what it can't play yet rather than leaving it out silently", async () => {
    const store = project();
    const track = trackWith(store, "subtractive", [{ pitch: 60, start: 0, length: 1 }]);
    store.addMidiDevice(track.id, "octavator");
    const song = await render(store);
    expect(song.omitted).toEqual([expect.stringContaining("MIDI devices aren't rendered yet")]);
  });

  it("reports the level going into the master, past the soft clip", async () => {
    const store = project();
    const chord = [48, 52, 55, 60, 64, 67, 72].map((pitch) => ({ pitch, start: 0, length: 2 }));
    trackWith(store, "supersaw", chord);
    const song = await render(store);
    expect(song.masterPeak).toBeGreaterThan(1);
    expect(peakOf(song)).toBeLessThanOrEqual(1);
  });
});
