import { describe, expect, it } from "vitest";
import { DeviceRenderError, renderDevice, type Rendered } from "../src/audio/render/renderDevice";
import { decodeWav } from "../src/audio/render/wav";
import { loadNodeSample, nodeRenderSetup } from "../server/render/nodeRender";
import { BUILTIN_URLS } from "../src/audio/samples/builtinUrls";
import { BUILTIN_SAMPLES, builtinRef } from "../src/audio/samples/catalog";
import { ENGINE_INSTRUMENTS } from "../src/audio/instruments/engine";
import { ENGINE_EFFECTS } from "../src/audio/effects/engine";

const peakOf = ({ channels }: Rendered) =>
  channels.reduce((most, channel) => channel.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), most), 0);
const finite = ({ channels }: Rendered) => channels.every((channel) => channel.every(Number.isFinite));

describe("renderDevice (AGENT-4.9): a device alone, on the engine, in Node", () => {
  it.each(ENGINE_INSTRUMENTS.map((instrument) => [instrument.type, instrument] as const))(
    "%s plays a note, samples and all",
    async (_type, { type }) => {
      // A kick (a kit's GM pad) and middle C, so a kit and a tonal instrument both sound.
      const rendered = await renderDevice(
        { instrument: { type } },
        {
          kind: "notes",
          notes: [
            { pitch: 36, start: 0, length: 0.4 },
            { pitch: 60, start: 0.4, length: 0.4 },
          ],
        },
        1,
        nodeRenderSetup(),
      );
      expect(finite(rendered)).toBe(true);
      expect(peakOf(rendered)).toBeGreaterThan(0.01);
    },
  );

  it.each(ENGINE_EFFECTS.map((effect) => [effect.type] as const))("%s processes a tone burst", async (type) => {
    const rendered = await renderDevice(
      { effects: [{ type }] },
      { kind: "burst", frequency: 440, seconds: 0.2 },
      0.5,
      nodeRenderSetup(),
    );
    expect(finite(rendered)).toBe(true);
    expect(peakOf(rendered)).toBeGreaterThan(0.001);
  });

  it("starts a note on its sample, and stays silent before it", async () => {
    const rendered = await renderDevice(
      { instrument: { type: "subtractive" } },
      { kind: "notes", notes: [{ pitch: 60, start: 0.25, length: 0.2 }] },
      0.5,
      nodeRenderSetup(),
    );
    const first = rendered.channels[0].findIndex((sample) => sample !== 0);
    expect(first).toBeGreaterThanOrEqual(0.25 * rendered.sampleRate);
    expect(first).toBeLessThan(0.25 * rendered.sampleRate + 8);
  });

  it("plays the effects after the instrument, with their params", async () => {
    const note = { kind: "notes" as const, notes: [{ pitch: 60, start: 0, length: 0.3 }] };
    const dry = await renderDevice({ instrument: { type: "subtractive" } }, note, 1, nodeRenderSetup());
    const wet = await renderDevice(
      { instrument: { type: "subtractive" }, effects: [{ type: "reverb", params: { mix: 1 } }] },
      note,
      1,
      nodeRenderSetup(),
    );
    // The reverb rings on after the dry note has finished.
    const tail = (rendered: Rendered) =>
      peakOf({
        ...rendered,
        channels: [
          rendered.channels[0].subarray(rendered.sampleRate * 0.8),
          rendered.channels[1].subarray(rendered.sampleRate * 0.8),
        ],
      });
    expect(tail(wet)).toBeGreaterThan(tail(dry) * 10);
  });

  it("refuses notes without an instrument, and a signal into one", async () => {
    await expect(
      renderDevice({ effects: [{ type: "reverb" }] }, { kind: "notes", notes: [] }, 0.1, nodeRenderSetup()),
    ).rejects.toBeInstanceOf(DeviceRenderError);
    await expect(
      renderDevice({ instrument: { type: "subtractive" } }, { kind: "impulse" }, 0.1, nodeRenderSetup()),
    ).rejects.toBeInstanceOf(DeviceRenderError);
  });
});

describe("the built-in kit, found by file name", () => {
  it.each(BUILTIN_SAMPLES.map((sample) => [sample.id] as const))(
    "%s is bundled for the browser and read in Node",
    async (id) => {
      expect(BUILTIN_URLS[id]).toBeTruthy();
      const audio = await loadNodeSample(builtinRef(id));
      expect(audio?.channels[0].length).toBeGreaterThan(100);
    },
  );
});

describe("decodeWav", () => {
  /** A WAV file of `frames` per channel, written the way a recorder would. */
  const wavOf = (
    format: number,
    bits: number,
    channels: number[][],
    write: (view: DataView, offset: number, value: number) => void,
  ) => {
    const frames = channels[0].length;
    const bytes = bits / 8;
    const data = frames * channels.length * bytes;
    const view = new DataView(new ArrayBuffer(44 + data));
    const text = (offset: number, value: string) =>
      [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + data, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, channels.length, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 44100 * channels.length * bytes, true);
    view.setUint16(32, channels.length * bytes, true);
    view.setUint16(34, bits, true);
    text(36, "data");
    view.setUint32(40, data, true);
    channels[0].forEach((_, frame) =>
      channels.forEach((channel, index) => write(view, 44 + (frame * channels.length + index) * bytes, channel[frame])),
    );
    return new Uint8Array(view.buffer);
  };
  const left = [0, 0.5, -0.5, 0.25];
  const right = [0.75, -0.25, 0, -1];

  it("reads 16-bit stereo PCM", () => {
    const audio = decodeWav(
      wavOf(1, 16, [left, right], (view, offset, value) => view.setInt16(offset, Math.round(value * 32767), true)),
    );
    expect(audio.rate).toBe(44100);
    expect(audio.channels).toHaveLength(2);
    audio.channels[1].forEach((sample, index) => expect(sample).toBeCloseTo(right[index], 3));
  });

  it("reads 24-bit PCM, negative samples included", () => {
    const audio = decodeWav(
      wavOf(1, 24, [left], (view, offset, value) => {
        const scaled = Math.round(value * 8388607);
        [0, 1, 2].forEach((byte) => view.setUint8(offset + byte, (scaled >> (8 * byte)) & 0xff));
      }),
    );
    audio.channels[0].forEach((sample, index) => expect(sample).toBeCloseTo(left[index], 5));
  });

  it("reads 32-bit float", () => {
    const audio = decodeWav(wavOf(3, 32, [left], (view, offset, value) => view.setFloat32(offset, value, true)));
    expect(Array.from(audio.channels[0])).toEqual(left);
  });

  it("refuses what isn't a WAV file", () => {
    expect(() => decodeWav(new Uint8Array(64))).toThrow();
  });
});
