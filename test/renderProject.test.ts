import { describe, expect, it } from "vitest";
import { renderProject, type ProjectRender } from "../src/audio/render/renderProject";
import { renderDevice, type Rendered } from "../src/audio/render/renderDevice";
import { nodeRenderSetup } from "../server/render/nodeRender";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { resampled } from "../src/audio/render/audioTape";
import type { LoadAudio } from "../src/audio/render/sampleAudio";

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
const render = (store: ProjectStore, loadAudio?: LoadAudio) =>
  renderProject(store, { ...nodeRenderSetup(), loadAudio }, { tailSec: 1 });

/** A recorded take: a quarter second of a 220 Hz sine at half scale, at `rate`. */
const take = (rate = 48000) => ({
  channels: [Float32Array.from({ length: rate / 4 }, (_, frame) => 0.5 * Math.sin((2 * Math.PI * 220 * frame) / rate))],
  rate,
});
const loadTake =
  (rate?: number): LoadAudio =>
  async (fileId) =>
    fileId === "take" ? take(rate) : null;

/** Where a render is louder than `floor`: its first and last frames. */
const soundingSpan = ({ channels }: Rendered, floor = 1e-4) => {
  const loud = Array.from(channels[0], (sample, frame) => (Math.abs(sample) > floor ? frame : -1)).filter(
    (frame) => frame >= 0,
  );
  return [loud[0], loud[loud.length - 1]];
};

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

  it("plays a track's notes through its MIDI devices", async () => {
    const store = project();
    const track = trackWith(store, "subtractive", [{ pitch: 60, start: 1, length: 1 }]);
    store.addMidiDevice(track.id, "octavator");
    const doubled = await render(store);

    // The octavator's defaults: the note, and an octave up at 0.7 of its velocity.
    const written = project();
    const byHand = trackWith(written, "subtractive", []);
    byHand.clips[0].store.addNote({ pitch: 60, start: 1, length: 1, velocity: 0.8 });
    byHand.clips[0].store.addNote({ pitch: 72, start: 1, length: 1, velocity: 0.8 * 0.7 });
    const expected = await render(written);
    expect(doubled.omitted).toEqual([]);
    doubled.channels[0].forEach((sample, index) => expect(sample).toBeCloseTo(expected.channels[0][index], 5));
  });

  it("steps a generator on the render's own clock, phrase after phrase", async () => {
    // A chord held for a beat, twice: the arpeggiator's defaults (1/8, up, gate 0.5) play its lowest
    // two notes each time, starting over after the gap.
    const chord = (start: number) => [60, 64, 67].map((pitch) => ({ pitch, start, length: 1 }));
    const store = project();
    const track = trackWith(store, "subtractive", [...chord(0), ...chord(2)]);
    store.addMidiDevice(track.id, "arpeggiator");
    const arpeggiated = await render(store);

    const written = project();
    trackWith(
      written,
      "subtractive",
      [0, 2].flatMap((start) => [
        { pitch: 60, start, length: 0.25 },
        { pitch: 64, start: start + 0.5, length: 0.25 },
      ]),
    );
    const expected = await render(written);
    arpeggiated.channels[0].forEach((sample, index) => expect(sample).toBeCloseTo(expected.channels[0][index], 5));
  });

  it("plays an audio clip where it's placed, at the track's volume", async () => {
    const store = project();
    store.addAudioTrack({ fileId: "take", durationSec: 0.25, startBeat: 1, length: 0.5 });
    const song = await render(store, loadTake());
    const at = 0.5 * song.sampleRate;
    const { channels } = take();
    expect(song.omitted).toEqual([]);
    channels[0].forEach((sample, frame) => expect(song.channels[1][at + frame]).toBeCloseTo(sample * 0.8 * 0.8, 6));
    expect(soundingSpan(song)).toEqual([at + 1, at + channels[0].length - 1]);
  });

  it("brings a file at another rate to the render's", async () => {
    const store = project();
    store.addAudioTrack({ fileId: "take", durationSec: 0.25, startBeat: 0, length: 0.5 });
    const [first, last] = soundingSpan(await render(store, loadTake(24000)));
    expect(first).toBeLessThan(4);
    expect(last).toBeGreaterThan(0.25 * 48000 - 8);
    expect(last).toBeLessThan(0.25 * 48000);
    expect(resampled(new Float32Array([0, 1, 0]), 1, 2)).toEqual(new Float32Array([0, 0.5, 1, 0.5, 0, 0]));
  });

  it("repeats a clip's loop region to fill its placement, and runs the track's effects on it", async () => {
    const store = project();
    const track = store.addAudioTrack({ fileId: "take", durationSec: 0.25, startBeat: 0, length: 2 });
    store.setAudioClip(track.id, track.clips[0].id, { loopEndSec: 0.125 });
    const looped = await render(store, loadTake());
    // An eighth of a second, a quarter beat at 120, played every quarter beat for two beats.
    expect(soundingSpan(looped)[1]).toBeGreaterThan(0.99 * 48000);
    expect(soundingSpan(looped)[1]).toBeLessThan(1.0 * 48000);

    store.addEffect(track.id, "reverb");
    const wet = await render(store, loadTake());
    expect(peakOf(wet, 1.5 * 48000)).toBeGreaterThan(1e-3);
  });

  it("names audio clips it has no way to load, or whose file won't load", async () => {
    const store = project();
    store.addAudioTrack({ fileId: "gone", durationSec: 0.25 }, { name: "Vox" });
    expect((await render(store)).omitted).toEqual([expect.stringContaining("can't be loaded here")]);
    const missing = await render(store, loadTake());
    expect(missing.omitted).toEqual([expect.stringContaining("file gone wouldn't load")]);
    expect(peakOf(missing)).toBe(0);
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
