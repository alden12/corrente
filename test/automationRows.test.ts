/** How automation stacks on the timeline (DAW-67.4): rows packed by overlap, and the curve drawn. */
import { describe, expect, it } from "vitest";
import { packRuns, runCurve } from "../src/audio/automation/rows";
import type { AutomationRun } from "../src/audio/automation/playback";
import type { AutomationClipData } from "../src/audio/project/types";

const clip = { id: "a" } as AutomationClipData;
const run = (startBeat: number, length: number): AutomationRun => ({ clip, startBeat, length, offset: 0 });

describe("automation rows", () => {
  it("shares a row between runs that don't overlap, and gives an overlap the next free one", () => {
    const { packed, rows } = packRuns([run(0, 4), run(2, 4), run(4, 2), run(5, 1), run(6, 2)]);
    expect(packed.map((entry) => entry.row)).toEqual([0, 1, 0, 2, 0]);
    expect(rows).toBe(3);
  });

  it("draws the curve across the run, 0 at the bottom", () => {
    const points = runCurve((beat) => beat / 4, run(0, 4), 8, 10, 4).split(" ");
    expect(points).toEqual(["0.0,10.0", "4.0,5.0", "8.0,0.0"]);
    expect(runCurve(() => undefined, run(0, 4), 0, 10)).toBe("");
  });
});
