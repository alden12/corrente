import { describe, expect, it } from "vitest";
import {
  ACCIDENTAL_HEIGHT,
  KEYS_SHARE,
  PAD_HEIGHT,
  ROW_GAP,
  BARE_ROW_GAP,
  rowGap,
  fitPads,
  keysHeight,
  keysRoom,
  padRowHeight,
  PAD_GAP,
} from "../src/ui/pads/geometry";

/**
 * The Studio's height (between the top bar and the tabs, keys included) on each shape, measured in
 * the browser. These are the numbers the fitting has to be right about.
 */
const STUDIO = { phone: 700, landscape: 284, tablet: 640, tabletPortrait: 900 };

describe("padRowHeight", () => {
  it("counts the accidental band only when the accidentals are on", () => {
    expect(padRowHeight(true)).toBe(PAD_HEIGHT + ACCIDENTAL_HEIGHT + PAD_GAP + ROW_GAP);
    expect(padRowHeight(false)).toBe(PAD_HEIGHT + BARE_ROW_GAP);
  });

  it("leaves more room between rows with the accidentals off", () => {
    // With the band there, it separates one row of naturals from the next. Without it the
    // rows abut, and the gap is the only thing stopping a fingertip landing on two octaves
    // at once - so it has to be the bigger of the two, not the same number reused.
    expect(BARE_ROW_GAP).toBeGreaterThan(ROW_GAP);
    expect(rowGap(true)).toBe(ROW_GAP);
    expect(rowGap(false)).toBe(BARE_ROW_GAP);
  });
});

describe("fitPads", () => {
  it("fits exactly the rows whose height it was given, and no more", () => {
    [1, 2, 3].forEach((rows) => {
      expect(fitPads(keysHeight(rows, true), true)).toBe(rows);
      expect(fitPads(keysHeight(rows, true) - 1, true)).toBe(rows - 1);
    });
  });

  it("says zero rather than a clipped row when one does not fit", () => {
    expect(fitPads(keysHeight(1, true) - 1, true)).toBe(0);
    expect(fitPads(0, true)).toBe(0);
  });

  it("fits more rows with the accidentals off, in the same room", () => {
    expect(fitPads(400, false)).toBeGreaterThan(fitPads(400, true));
  });

  it("grows monotonically with the room", () => {
    const rows = [100, 200, 300, 400, 600, 900].map((room) => fitPads(room, true));
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
  });
});

describe("keysRoom", () => {
  it("gives the keys less at Half than at Full, so they never bury a half-open sheet", () => {
    expect(KEYS_SHARE.half).toBeLessThan(KEYS_SHARE.full);
    expect(fitPads(keysRoom(STUDIO.phone, "half"), true)).toBeLessThan(fitPads(keysRoom(STUDIO.phone, "full"), true));
  });

  it("gives a phone held upright more than one row at Full", () => {
    expect(fitPads(keysRoom(STUDIO.phone, "full"), true)).toBeGreaterThan(1);
  });

  it("never lets the keys take more than half the Studio", () => {
    Object.values(STUDIO).forEach((studio) => {
      (["peek", "half", "full"] as const).forEach((detent) => {
        const rows = fitPads(keysRoom(studio, detent), true);
        expect(keysHeight(rows, true)).toBeLessThanOrEqual(studio / 2);
      });
    });
  });

  it("still gives a phone on its side one row at Half", () => {
    expect(fitPads(keysRoom(STUDIO.landscape, "half"), true)).toBe(1);
  });
});
