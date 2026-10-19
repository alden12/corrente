/**
 * A WAV file's samples, for renders where Web Audio isn't there to decode (AGENT-4.9): the built-in
 * kit in Node. PCM at 8, 16, 24 or 32 bits, or 32-bit float; the first two channels.
 */
import type { SampleAudio } from "../bank/bank";

const PCM = 1;
const FLOAT = 3;
/** WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of its sub-format GUID. */
const EXTENSIBLE = 0xfffe;

/** Reads one sample at a byte offset as -1..1, by format and bits per sample. */
const READERS: Record<string, (view: DataView, offset: number) => number> = {
  "1:8": (view, offset) => (view.getUint8(offset) - 128) / 128,
  "1:16": (view, offset) => view.getInt16(offset, true) / 32768,
  "1:24": (view, offset) =>
    (view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16)) / 8388608,
  "1:32": (view, offset) => view.getInt32(offset, true) / 2147483648,
  "3:32": (view, offset) => view.getFloat32(offset, true),
};

/** The chunks of a RIFF WAVE file by id, each as its offset and size. */
function chunksOf(view: DataView): Map<string, { offset: number; size: number }> {
  const chunks = new Map<string, { offset: number; size: number }>();
  const id = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((index) => view.getUint8(offset + index)));
  if (view.byteLength < 12 || id(0) !== "RIFF" || id(8) !== "WAVE") throw new Error("not a WAV file");
  // Chunks are padded to an even length.
  for (let offset = 12; offset + 8 <= view.byteLength; ) {
    const size = view.getUint32(offset + 4, true);
    chunks.set(id(offset), { offset: offset + 8, size: Math.min(size, view.byteLength - offset - 8) });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

export function decodeWav(bytes: Uint8Array): SampleAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = chunksOf(view);
  const format = chunks.get("fmt ");
  const data = chunks.get("data");
  if (!format || !data) throw new Error("a WAV file without its format or data");
  const tag = view.getUint16(format.offset, true);
  const kind = tag === EXTENSIBLE ? view.getUint16(format.offset + 24, true) : tag;
  const channels = view.getUint16(format.offset + 2, true);
  const rate = view.getUint32(format.offset + 4, true);
  const bits = view.getUint16(format.offset + 14, true);
  const read = [PCM, FLOAT].includes(kind) ? READERS[`${kind}:${bits}`] : undefined;
  if (!read) throw new Error(`a WAV format this can't read (format ${kind}, ${bits} bits)`);
  const frameBytes = (bits / 8) * channels;
  const frames = Math.floor(data.size / frameBytes);
  return {
    channels: Array.from({ length: Math.min(2, channels) }, (_, channel) =>
      Float32Array.from({ length: frames }, (_, frame) =>
        read(view, data.offset + frame * frameBytes + channel * (bits / 8)),
      ),
    ),
    rate,
  };
}
