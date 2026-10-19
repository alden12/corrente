/**
 * A minimal PNG writer for the analysis pictures (AGENT-4.11): 8-bit RGB, no filtering, compressed
 * with the platform's `CompressionStream`, which browsers and Node both have. No image library.
 */

/** Each byte's CRC-32 remainder, the table PNG's chunk checksums use. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) =>
  Array.from({ length: 8 }).reduce<number>((crc) => (crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1), byte),
);

const crc32 = (bytes: Uint8Array): number =>
  (bytes.reduce((crc, byte) => CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

const uint32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

/** A chunk: its length, type, data and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = new Uint8Array(4 + data.length);
  typed.set([...type].map((letter) => letter.charCodeAt(0)));
  typed.set(data, 4);
  const whole = new Uint8Array(12 + data.length);
  whole.set(uint32(data.length));
  whole.set(typed, 4);
  whole.set(uint32(crc32(typed)), 8 + data.length);
  return whole;
}

/** zlib-compress, as PNG's image data is. */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Encode `rgb` (three bytes a pixel, row by row from the top) as a PNG file. */
export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  // Each row starts with its filter type, 0 for none.
  const rows = new Uint8Array(height * (width * 3 + 1));
  Array.from({ length: height }).forEach((_, row) =>
    rows.set(rgb.subarray(row * width * 3, (row + 1) * width * 3), row * (width * 3 + 1) + 1),
  );
  // Width, height, 8 bits a channel, colour type 2 (RGB), default compression, filtering and no interlace.
  const header = new Uint8Array([...uint32(width), ...uint32(height), 8, 2, 0, 0, 0]);
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", await deflate(rows)),
    chunk("IEND", new Uint8Array()),
  ];
  const file = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => (file.set(part, offset), offset + part.length), 0);
  return file;
}

/** Base64, as an MCP image block carries it. */
export const toBase64 = (bytes: Uint8Array): string =>
  btoa(
    Array.from({ length: Math.ceil(bytes.length / 0x8000) }, (_, index) =>
      String.fromCharCode(...bytes.subarray(index * 0x8000, (index + 1) * 0x8000)),
    ).join(""),
  );
