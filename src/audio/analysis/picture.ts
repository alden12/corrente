/**
 * The spectrogram as a picture Claude can read (AGENT-4.11): time across, frequency up on a log
 * scale, level as brightness on the magma palette, with Hz and seconds marked on the axes so it can
 * say where something happens. The ears spike found the labels matter: without them a reader guesses
 * at pitch and time.
 *
 * Drawn straight into pixels, labels in a small built-in pixel font, so it needs nothing but png.ts.
 */
import { encodePng, toBase64 } from "./png";
import { HIGHEST_HZ, LOWEST_HZ, spectrogramOf } from "./spectrogram";

/** The plot's size in pixels, and the margins the labels sit in. */
const PLOT = { width: 512, height: 256 };
const MARGIN = { left: 34, bottom: 16, top: 6, right: 16 };
const WIDTH = MARGIN.left + PLOT.width + MARGIN.right;
const HEIGHT = MARGIN.top + PLOT.height + MARGIN.bottom;

/** The level range the palette spans, in dBFS: quieter is black, 0 is the palette's top. */
export const LEVEL_RANGE = { quietest: -90, loudest: 0 } as const;

/** The picture's key, said alongside it so a reader knows how to read it. */
export const PICTURE_KEY =
  `Spectrogram: time across in seconds, frequency up on a log scale from ${LOWEST_HZ} Hz to ${HIGHEST_HZ / 1000} kHz, ` +
  `brightness is level on the magma palette from ${LEVEL_RANGE.quietest} dBFS (black) through purple and orange ` +
  `to ${LEVEL_RANGE.loudest} dBFS (pale yellow).`;

/** Matplotlib's magma at evenly spaced stops, from quiet to loud. */
const MAGMA: [number, number, number][] = [
  [0, 0, 4],
  [28, 16, 68],
  [79, 18, 123],
  [129, 37, 129],
  [181, 54, 122],
  [229, 80, 100],
  [251, 135, 97],
  [254, 194, 135],
  [252, 253, 191],
];

const colourOf = (db: number): [number, number, number] => {
  const position =
    Math.min(1, Math.max(0, (db - LEVEL_RANGE.quietest) / (LEVEL_RANGE.loudest - LEVEL_RANGE.quietest))) *
    (MAGMA.length - 1);
  const below = Math.min(MAGMA.length - 2, Math.floor(position));
  const blend = position - below;
  return MAGMA[below].map((channel, index) => Math.round(channel + (MAGMA[below + 1][index] - channel) * blend)) as [
    number,
    number,
    number,
  ];
};

/** A 3x5 pixel font, each glyph's rows top to bottom as three bits. Just what the labels use. */
const GLYPHS: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7],
  "1": [2, 6, 2, 2, 7],
  "2": [7, 1, 7, 4, 7],
  "3": [7, 1, 7, 1, 7],
  "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7],
  "6": [7, 4, 7, 5, 7],
  "7": [7, 1, 1, 1, 1],
  "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7],
  k: [4, 5, 6, 5, 5],
  s: [3, 4, 2, 1, 6],
  ".": [0, 0, 0, 0, 2],
};
/** Glyphs drawn at twice size: 6 by 10 pixels, 8 apart. */
const SCALE = 2;
const ADVANCE = 4 * SCALE;

const INK: [number, number, number] = [220, 220, 228];
const BACKGROUND: [number, number, number] = [24, 24, 30];

/** Frequency ticks, in Hz. */
const HZ_TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/** A step between second ticks that gives at most about ten. */
const secondStep = (durationSec: number) =>
  [0.5, 1, 2, 5, 10, 20, 30, 60].find((step) => durationSec / step <= 10) ?? 120;

/** Draw the spectrogram of `channels` and encode it: a PNG, as base64. */
export async function spectrogramPicture(channels: Float32Array[], sampleRate: number): Promise<string> {
  const { columns, durationSec } = spectrogramOf(channels, sampleRate, { width: PLOT.width, rows: PLOT.height });
  const pixels = new Uint8Array(WIDTH * HEIGHT * 3);
  const paint = (x: number, y: number, colour: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    pixels.set(colour, (y * WIDTH + x) * 3);
  };
  const text = (label: string, x: number, y: number) =>
    [...label].forEach((letter, index) =>
      (GLYPHS[letter] ?? []).forEach((bits, row) =>
        [0, 1, 2].forEach((column) => {
          if (!((bits >> (2 - column)) & 1)) return;
          [0, 1].forEach((dx) =>
            [0, 1].forEach((dy) => paint(x + index * ADVANCE + column * SCALE + dx, y + row * SCALE + dy, INK)),
          );
        }),
      ),
    );
  const textWidth = (label: string) => label.length * ADVANCE - SCALE;

  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) paint(x, y, BACKGROUND);
  columns.forEach((levels, x) =>
    levels.forEach((db, row) => paint(MARGIN.left + x, MARGIN.top + PLOT.height - 1 - row, colourOf(db))),
  );

  // Frequency up the left, each tick at its row.
  const rowOf = (hz: number) => (Math.log(hz / LOWEST_HZ) / Math.log(HIGHEST_HZ / LOWEST_HZ)) * (PLOT.height - 1);
  HZ_TICKS.forEach((hz) => {
    const y = Math.round(MARGIN.top + PLOT.height - 1 - rowOf(hz));
    [1, 2, 3].forEach((dx) => paint(MARGIN.left - dx, y, INK));
    const label = hzLabel(hz);
    text(label, MARGIN.left - 5 - textWidth(label), Math.min(HEIGHT - 10, Math.max(0, y - 5)));
  });
  // Seconds along the bottom.
  const step = secondStep(durationSec);
  Array.from({ length: Math.floor(durationSec / step) + 1 }, (_, index) => index * step).forEach((seconds) => {
    const x = Math.round(MARGIN.left + (seconds / durationSec) * (PLOT.width - 1));
    [1, 2, 3].forEach((dy) => paint(x, MARGIN.top + PLOT.height - 1 + dy, INK));
    const label = `${seconds}s`;
    text(
      label,
      Math.min(WIDTH - textWidth(label), Math.max(0, x - textWidth(label) / 2)),
      MARGIN.top + PLOT.height + 4,
    );
  });

  return toBase64(await encodePng(WIDTH, HEIGHT, pixels));
}
