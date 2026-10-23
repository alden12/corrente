import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindingOf } from "../src/audio/bank/binding";
import { instrumentChain } from "../src/audio/bank/chainPlan";
import type { DevicePackage, PackageSamples } from "../src/audio/bank/devicePackage";
import { DEFAULT_INSTRUMENT } from "../src/audio/instruments/catalog";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { PluginDevice, projectOfRack, type ToPlugin } from "../src/plugin/pluginDevice";

/**
 * The plugin window's half (PLUGIN-3.2): a new device is a `load` with its package, a knob or a
 * bypass a `value`, and the project a `rack`, a moment after the last change.
 */

/** Stand-in sample sources: a file is its ref's bytes, a table two floats. */
const samples: PackageSamples = {
  file: async (ref) => new TextEncoder().encode(ref),
  table: async () => Float32Array.from([0.5, -0.5]),
};

/** A fresh window's project and what it sent, started. */
const started = async (type = DEFAULT_INSTRUMENT) => {
  const project = new ProjectStore(false);
  const track = project.addTrack(type) as InstrumentTrack;
  const sent: ToPlugin[] = [];
  const device = new PluginDevice(project, samples, (message) => sent.push(message));
  device.start();
  await device.settled();
  return { project, track, sent, device };
};

const loads = (sent: ToPlugin[]): DevicePackage[] =>
  sent.flatMap((message) => (message.type === "load" ? [JSON.parse(message.package) as DevicePackage] : []));

const numberOf = (track: InstrumentTrack, effects: InstrumentTrack["effects"], id: string) => {
  const chain = instrumentChain(track.instrumentType, track.params, effects)!;
  const name = Object.entries(chain.plan.sources).find(([, source]) => source.id === id)?.[0];
  return bindingOf(chain.plan.plan).numbers.get(name!)!;
};

describe("PluginDevice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends a fresh window's device as the plugin has it built in, so opening the window rebuilds nothing", async () => {
    const { sent } = await started();
    const builtIn = JSON.parse(readFileSync("plugin/corrente/device.json", "utf8")) as DevicePackage;
    const [made] = loads(sent);
    expect(loads(sent)).toHaveLength(1);
    expect({ ...made, label: builtIn.label }).toEqual(builtIn);
  });

  it("sends a knob as its value's number and engine value, with no new package", async () => {
    const { track, sent } = await started();
    sent.length = 0;
    track.params.set("filter.cutoff", 1000);
    expect(sent).toEqual([{ type: "value", value: numberOf(track, [], "filter.cutoff"), raw: 1000 }]);
  });

  it("sends a new package for an added effect, and its bypass as a value", async () => {
    const { project, track, sent, device } = await started();
    const [alone] = loads(sent);
    sent.length = 0;
    const effect = project.addEffect(track.id, "delay")!;
    await device.settled();
    const [withDelay] = loads(sent);
    expect(withDelay.values.length).toBeGreaterThan(alone.values.length);
    sent.length = 0;
    project.setEffectBypass(track.id, effect.id, true);
    expect(sent).toEqual([expect.objectContaining({ type: "value", raw: 1 })]);
  });

  it("sends a new package when a sample changes, with the sample in it", async () => {
    const { track, sent, device } = await started("sampler");
    sent.length = 0;
    track.params.set("sampler.sample", "builtin:snare");
    await device.settled();
    const [made] = loads(sent);
    expect(made.values).toContainEqual(expect.objectContaining({ kind: "sample", ref: "builtin:snare" }));
  });

  it("sends the project a moment after the last change, as a rack that reads back", async () => {
    const { track, sent } = await started("sampler");
    track.params.set("sampler.sample", "builtin:snare");
    expect(sent.filter((message) => message.type === "rack")).toHaveLength(0);
    await vi.runAllTimersAsync();
    const racks = sent.flatMap((message) => (message.type === "rack" ? [message.rack] : []));
    expect(racks).toHaveLength(1);
    const restored = new ProjectStore(false);
    restored.load(projectOfRack(racks[0])!);
    const [again] = restored.getTracks() as InstrumentTrack[];
    expect([again.instrumentType, again.params.get("sampler.sample")]).toEqual(["sampler", "builtin:snare"]);
  });

  it("reads a rack it can't as nothing, so the window starts afresh", () => {
    expect(projectOfRack("not json")).toBeUndefined();
    expect(projectOfRack(JSON.stringify({ version: 10, project: { tracks: "no" } }))).toBeUndefined();
  });
});
