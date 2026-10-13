import { describe, expect, it } from "vitest";
import { PREVIEW_BARS, previewWindow } from "../src/ui/shell/previewWindow";

describe("clip preview window", () => {
  it("shows a clip whole up to the cap, in bars of the project's time signature", () => {
    expect(previewWindow(16, 4)).toEqual({ length: 16, continues: false });
    expect(previewWindow(PREVIEW_BARS * 4, 4)).toEqual({ length: PREVIEW_BARS * 4, continues: false });
  });

  it("shows only the opening bars of a longer clip, and says it continues", () => {
    expect(previewWindow(64, 4)).toEqual({ length: PREVIEW_BARS * 4, continues: true });
    // A 3/4 bar is three beats, so the cap is shorter in beats.
    expect(previewWindow(64, 3)).toEqual({ length: PREVIEW_BARS * 3, continues: true });
  });
});
