import { describe, expect, it } from "vitest";
import { INSTRUMENT_STAGE, KEY_LEVELS, groupDepth, groupEffectStage, trackEffectStage } from "../src/audio/bank/stages";

/**
 * Engine banks by stage (INST-36.7): audio only flows to later stages, so no bank's output finds
 * its way back into it, which Web Audio would silence as a loop.
 */
describe("stages", () => {
  it("put instruments, then a track's effects in order, then groups innermost first", () => {
    const flow = [
      INSTRUMENT_STAGE,
      trackEffectStage(0),
      trackEffectStage(1),
      trackEffectStage(98),
      groupEffectStage(3, 0),
      groupEffectStage(3, 5),
      groupEffectStage(2, 0),
      groupEffectStage(1, 0),
      groupEffectStage(1, 99),
    ];
    expect(flow).toEqual([...flow].sort((a, b) => a - b));
    expect(new Set(flow).size).toBe(flow.length);
  });

  it("put a track's keyed effects after every effect on the levels below, and groups after them all", () => {
    const flow = [
      trackEffectStage(98, 0),
      trackEffectStage(0, 1),
      trackEffectStage(98, 1),
      trackEffectStage(0, 2),
      trackEffectStage(98, KEY_LEVELS - 1),
      groupEffectStage(50, 0),
    ];
    expect(flow).toEqual([...flow].sort((a, b) => a - b));
    expect(new Set(flow).size).toBe(flow.length);
  });

  it("counts a group's depth from its parents", () => {
    const groups = [
      { id: "top", parentId: null },
      { id: "middle", parentId: "top" },
      { id: "inner", parentId: "middle" },
    ];
    expect(groups.map((group) => groupDepth(groups, group.id))).toEqual([1, 2, 3]);
  });
});
