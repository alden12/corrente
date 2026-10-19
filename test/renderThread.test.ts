import { describe, expect, it } from "vitest";
import { renderInThread } from "../server/render/threadRender";
import { engineCopy, nodeRenderSetup, storedAudio } from "../server/render/nodeRender";
import { renderProject } from "../src/audio/render/renderProject";
import { RenderTimeoutError } from "../src/audio/render/worker/renderClient";
import { encodeWavBuffer } from "../src/audio/recording/wav";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";

/** A recorded take, stored as a project's recordings are: a quarter second of 220 Hz, as WAV bytes. */
const TAKE = new Uint8Array(
  encodeWavBuffer(
    Float32Array.from({ length: 12000 }, (_, frame) => 0.5 * Math.sin((2 * Math.PI * 220 * frame) / 48000)),
    48000,
  ),
);
const read = async (contentHash: string) => (contentHash === "take" ? TAKE : null);

/** A bar with a drum hit (a built-in sample from disk), a synth and a recorded take (from storage). */
const song = (take = "take") => {
  const store = new ProjectStore(false);
  store.setTempo(120);
  store.setLength(4);
  const kit = store.addTrack("sampler") as InstrumentTrack;
  kit.clips[0].store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
  const keys = store.addTrack("subtractive") as InstrumentTrack;
  [60, 64, 67].forEach((pitch) => keys.clips[0].store.addNote({ pitch, start: 1, length: 2, velocity: 0.6 }));
  store.addAudioTrack({ fileId: take, durationSec: 0.25, startBeat: 2, length: 0.5 });
  return store;
};

describe("rendering on a worker thread (AGENT-4.9 part 3c)", () => {
  it("hears what the core does on the calling thread, samples and recordings included", async () => {
    const store = song();
    const load = storedAudio(store.getSamples(), read);
    const threaded = await renderInThread({ project: store.snapshot(), engine: engineCopy(), sampleRate: 48000, load });
    const direct = await renderProject(store, { ...nodeRenderSetup(), loadSample: load.sample, loadAudio: load.audio });
    expect(threaded.omitted).toEqual([]);
    expect(threaded.masterPeak).toBeGreaterThan(0.1);
    expect(threaded.channels[0]).toEqual(direct.channels[0]);
  });

  it("gives up on a render past its time, and the next render gets a new thread", async () => {
    const store = song();
    const job = { project: store.snapshot(), sampleRate: 48000, load: storedAudio([], read) };
    await expect(renderInThread({ ...job, engine: engineCopy(), timeoutMs: 1 })).rejects.toBeInstanceOf(
      RenderTimeoutError,
    );
    expect((await renderInThread({ ...job, engine: engineCopy() })).masterPeak).toBeGreaterThan(0.1);
  });

  it("names a stored file it can't decode, rather than going quiet about it", async () => {
    // Its own content hash: decoded files are kept by hash, and a hash is always the same bytes.
    const store = song("an-mp3");
    const load = storedAudio(store.getSamples(), async () => new TextEncoder().encode("ID3 not a wav"));
    const render = await renderInThread({ project: store.snapshot(), engine: engineCopy(), sampleRate: 48000, load });
    expect(render.omitted).toEqual([expect.stringContaining("file an-mp3 wouldn't load")]);
  });
});
