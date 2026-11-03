import { describe, expect, it } from "vitest";
import { slideChanges } from "../src/ui/pads/usePadTouch";

describe("sliding between pads (MOBILE-37)", () => {
  it("starts the new note before stopping the old one, so a legato instrument glides", () => {
    expect(slideChanges([60], [62], new Set())).toEqual([
      { on: true, pitch: 62 },
      { on: false, pitch: 60 },
    ]);
  });

  it("keeps a note the two chords share sounding, rather than restarting it", () => {
    // C major to A minor share C and E.
    expect(slideChanges([60, 64, 67], [57, 60, 64], new Set())).toEqual([
      { on: true, pitch: 57 },
      { on: false, pitch: 67 },
    ]);
  });

  it("leaves alone the notes another finger is holding", () => {
    expect(slideChanges([60], [62], new Set([60, 62]))).toEqual([]);
  });
});
