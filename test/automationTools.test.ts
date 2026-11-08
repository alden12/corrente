/**
 * The automation tools (DAW-67.3), through the in-app agent's toolset: each edit lands as one
 * command, the defaults are pinned, and a bad knob is refused with what to call instead.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { createAgentTools } from "../src/audio/agent/tools";
import type { AgentTool } from "../src/audio/agent/types";
import type { Scheduler } from "../src/audio/sequencer/scheduler";

let store: ProjectStore;
let log: EditLog;
let tools: AgentTool[];
let track: InstrumentTrack;
const run = (name: string, args: Record<string, unknown> = {}) => {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.run({ track: track.id, ...args }) as Promise<Record<string, unknown>>;
};

beforeEach(() => {
  store = new ProjectStore(false);
  log = new EditLog(store);
  tools = createAgentTools({
    projectStore: store,
    dispatch: log.dispatch,
    scheduler: {} as Scheduler,
    author: "agent:you",
  });
  log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
  log.dispatch({ type: "addEffect", hostId: "t-1", effectType: "delay", id: "fx-1" });
  track = store.getTrack("t-1") as InstrumentTrack;
});

describe("automation tools", () => {
  it("add_automation makes a placed clip driving knobs, ranges defaulting to each knob's", async () => {
    const added = await run("add_automation", {
      name: "Sweep",
      points: [
        { beat: 0, value: 0 },
        { beat: 8, value: 1, bend: 0.5 },
      ],
      drives: [
        { device: "instrument", param: "filter.cutoff" },
        { device: "fx-1", param: "mix", min: 0.4, max: 0 },
      ],
      start_beat: 4,
    });
    const [clip] = track.automations;
    expect(clip).toMatchObject({ id: added.id, name: "Sweep", author: "agent:you" });
    const cutoff = track.params.spec("filter.cutoff");
    expect(clip.bindings.map((binding) => [binding.param, binding.min, binding.max])).toEqual([
      ["filter.cutoff", cutoff.kind === "number" && cutoff.min, cutoff.kind === "number" && cutoff.max],
      ["mix", 0.4, 0],
    ]);
    expect(track.automationPlacements).toEqual([
      { id: added.placementId, clipId: clip.id, startBeat: 4, offset: 0, length: store.newClipLength },
    ]);
    expect(log.getEntries().at(-1)!.command.type).toBe("addAutomation");
  });

  it("links to a note clip, and changes, places, moves and removes a clip", async () => {
    const linked = await run("add_automation", { linked_clip: track.activeClipId });
    expect(track.automations[0].linkedClipId).toBe(track.activeClipId);
    await run("set_automation", {
      automation: linked.id,
      name: "Wobble",
      points: [{ beat: 0, value: 0.5, shape: "sine" }],
    });
    expect(track.automations[0]).toMatchObject({ name: "Wobble", points: [{ shape: "sine", value: 0.5 }] });
    const { placementId } = await run("place_automation", { automation: linked.id, start_beat: 2 });
    expect(track.automations[0].linkedClipId).toBeUndefined();
    await run("set_automation_placement", { placement: placementId, start_beat: 6, length: 2 });
    expect(track.automationPlacements[0]).toMatchObject({ startBeat: 6, length: 2 });
    const listed = (await run("list_automation")).automations as { placements: unknown[] }[];
    expect(listed[0].placements).toHaveLength(1);
    await run("set_automation_placement", { placement: placementId, remove: true });
    expect(track.automationPlacements).toEqual([]);
    await run("remove_automation", { automation: linked.id });
    expect(track.automations).toEqual([]);
  });

  it("refuses what it can't automate, saying what to call", async () => {
    await expect(run("add_automation", { drives: [{ device: "fx-nope", param: "mix" }] })).rejects.toThrow(
      /list_effects/,
    );
    await expect(run("add_automation", { drives: [{ device: "instrument", param: "nope" }] })).rejects.toThrow(
      /list_parameters/,
    );
    await expect(run("add_automation", { linked_clip: "c-nope" })).rejects.toThrow(/list_clips/);
    await expect(run("set_automation", { automation: "au-nope" })).rejects.toThrow(/list_automation/);
    expect(track.automations).toEqual([]);
  });
});
