import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { deviceAlone, DeviceAloneError } from "../src/audio/analysis/deviceAlone";
import { analyzeDeviceRender } from "../src/audio/analysis/analyzeDevice";
import { PHRASE_BEATS } from "../src/audio/analysis/phrases";
import { rowHz, spectrogramOf } from "../src/audio/analysis/spectrogram";
import { encodePng } from "../src/audio/analysis/png";
import { renderProject } from "../src/audio/render/renderProject";
import { nodeRenderSetup } from "../server/render/nodeRender";

/** Two tracks in a group with an effect, the first with a note and a two-effect chain. */
const project = () => {
  const store = new ProjectStore(false);
  store.setTempo(120);
  store.setLength(8);
  const lead = store.addTrack("subtractive") as InstrumentTrack;
  lead.clips[0].store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.8 });
  store.addEffect(lead.id, "delay");
  store.addEffect(lead.id, "reverb");
  store.addEffect(lead.parentId, "chorus");
  store.setVolume(lead.id, 0.3);
  store.addTrack("subtractive");
  return { store, lead: store.getTrack(lead.id) as InstrumentTrack };
};

describe("deviceAlone (AGENT-4.6): one track's sound, cut out of the project", () => {
  it("keeps the track at unity in plain groups, and drops everything else", () => {
    const { store, lead } = project();
    const { project: alone, played } = deviceAlone(store.snapshot(), { track: lead.id });
    expect(alone.tracks.map((track) => track.id)).toEqual([lead.id]);
    expect(alone.tracks[0].volume).toBe(1);
    expect(alone.tracks[0].effects?.map((effect) => effect.type)).toEqual(["delay", "reverb"]);
    expect(alone.groups.every((group) => group.effects.length === 0 && group.volume === 1)).toBe(true);
    expect(played).toBe("its own notes");
  });

  it("hears the chain only up to an effect, or the instrument alone", () => {
    const { store, lead } = project();
    const [delay] = lead.effects;
    const through = (id: string) => deviceAlone(store.snapshot(), { track: lead.id, through: id }).project.tracks[0];
    expect(through(delay.id).effects?.map((effect) => effect.type)).toEqual(["delay"]);
    expect(through("instrument").effects).toEqual([]);
    expect(() => through("fx-nope")).toThrow(/isn't an effect.*delay.*reverb/);
  });

  it("plays a phrase in place of its own notes, from the region's start", () => {
    const { store, lead } = project();
    const { project: alone, played } = deviceAlone(store.snapshot(), { track: lead.id, play: "bass" });
    const track = alone.tracks[0];
    expect(track.kind === "instrument" && track.clips?.[0].notes.length).toBe(32);
    expect(alone.lengthBeats).toBe(PHRASE_BEATS);
    expect(alone.loopStart).toBe(0);
    expect(played).toMatch(/^the bass phrase: eighth notes/);
  });

  it("plays chords when the track has no notes of its own, and names a track it can't find", () => {
    const store = new ProjectStore(false);
    const track = store.addTrack("subtractive") as InstrumentTrack;
    track.placements.forEach((placement) => store.removePlacement(track.id, placement.id));
    const empty = store.snapshot();
    expect(deviceAlone(empty, { track: track.id }).played).toMatch(/^the chords phrase/);
    expect(() => deviceAlone(empty, { track: "t-nope" })).toThrow(DeviceAloneError);
  });
});

describe("the spectrogram picture (AGENT-4.11)", () => {
  it("puts a sine's level in the row for its pitch", () => {
    const rate = 48000;
    const sine = Float32Array.from({ length: rate }, (_, index) => 0.5 * Math.sin((2 * Math.PI * 1000 * index) / rate));
    const { columns } = spectrogramOf([sine, sine], rate, { width: 8, rows: 256 });
    const levels = columns[4];
    const loudest = levels.indexOf(Math.max(...levels));
    expect(rowHz(loudest, 256)).toBeGreaterThan(950);
    expect(rowHz(loudest, 256)).toBeLessThan(1050);
    // A half-scale sine: -6 dBFS, less up to 1.4 dB when it falls between two bins (a Hann window's scalloping).
    expect(levels[loudest]).toBeLessThanOrEqual(-5.9);
    expect(levels[loudest]).toBeGreaterThan(-7.5);
  });

  it("writes a PNG another decoder reads", async () => {
    const rgb = Uint8Array.from({ length: 2 * 2 * 3 }, (_, index) => index * 10);
    const png = await encodePng(2, 2, rgb);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([2, 2]);
    const dataLength = view.getUint32(33);
    const rows = inflateSync(png.subarray(41, 41 + dataLength));
    expect([...rows]).toEqual([0, ...rgb.subarray(0, 6), 0, ...rgb.subarray(6)]);
  });
});

describe("analyzeDeviceRender (AGENT-4.6): a sound measured on its own", () => {
  it("reports its levels, balance and width, and draws it when asked", async () => {
    const { store, lead } = project();
    const { project: alone, played } = deviceAlone(store.snapshot(), { track: lead.id, play: "chords" });
    const loaded = new ProjectStore(false);
    loaded.load(alone);
    const render = await renderProject(loaded, nodeRenderSetup(), { tailSec: 1 });
    const { summary, picture } = await analyzeDeviceRender(render, played, true);
    expect(summary.played).toMatch(/chords/);
    expect(summary.peakDbfs).toBeGreaterThan(-40);
    expect(Object.keys(summary.bands)).toContain("1k");
    expect(summary.centroidHz).toBeGreaterThan(100);
    expect(summary.stereoCorrelation).toBeLessThanOrEqual(1);
    expect(summary.pictureKey).toMatch(/log scale/);
    expect(Buffer.from(picture!, "base64").subarray(1, 4).toString()).toBe("PNG");
  });
});
