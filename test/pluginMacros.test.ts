import { describe, expect, it } from "vitest";
import type { PackageSamples } from "../src/audio/bank/devicePackage";
import { DEFAULT_INSTRUMENT } from "../src/audio/instruments/catalog";
import type { ParamSpec } from "../src/audio/params/types";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { PluginDevice, type ToPlugin } from "../src/plugin/pluginDevice";
import { MACROS, PluginMacros, mappingOf, positionOf, valueAt } from "../src/plugin/pluginMacros";

/**
 * The plugin's macros (PLUGIN-3.4): the first 16 params until the window maps one, then the mapping
 * as made, sent to the plugin as `macros`; and a macro the host moves sets its param in the window,
 * without sending it back.
 */

const samples: PackageSamples = {
  file: async (ref) => new TextEncoder().encode(ref),
  table: async () => Float32Array.from([0.5, -0.5]),
};

const started = async () => {
  const project = new ProjectStore(false);
  const track = project.addTrack(DEFAULT_INSTRUMENT) as InstrumentTrack;
  const sent: ToPlugin[] = [];
  const device = new PluginDevice(project, samples, (message) => sent.push(message));
  device.start();
  await device.settled();
  return { track, sent, device };
};

describe("PluginMacros", () => {
  it("maps the first 16 params until one is mapped", () => {
    const names = Array.from({ length: 20 }, (_, index) => `p${index}`);
    expect(mappingOf(null, names)).toEqual(names.slice(0, MACROS));
    expect(mappingOf(null, ["a", "b"])).toEqual(["a", "b", ...Array(MACROS - 2).fill(null)]);
  });

  it("maps a param to one macro, moving it off any other, and tells the plugin", () => {
    const sent: ToPlugin[] = [];
    const macros = new PluginMacros((message) => sent.push(message));
    const names = ["a", "b", "c"];
    macros.map("c", 0, names);
    const expected = ["c", "b", null, ...Array(MACROS - 3).fill(null)];
    expect(macros.mapping(names)).toEqual(expected);
    expect(sent).toEqual([{ type: "macros", slots: expected }]);
    macros.unmap("b", names);
    expect(macros.mapping(names).slice(0, 3)).toEqual(["c", null, null]);
  });

  it("reads a macro's position as the plugin does, for numbers, choices and switches", () => {
    const cutoff: ParamSpec = {
      id: "cutoff",
      label: "Cutoff",
      kind: "number",
      min: 20,
      max: 20000,
      default: 1000,
      taper: "exponential",
    };
    const wave: ParamSpec = {
      id: "wave",
      label: "Wave",
      kind: "enum",
      options: ["sine", "saw", "square"],
      default: "sine",
    };
    const on: ParamSpec = { id: "on", label: "On", kind: "boolean", default: false };
    expect(valueAt(cutoff, positionOf(cutoff, 1000)!)).toBeCloseTo(1000);
    expect(valueAt(wave, 0.5)).toBe("saw");
    expect(positionOf(wave, "square")).toBe(1);
    expect(valueAt(on, 0.7)).toBe(true);
  });
});

describe("PluginDevice from the host", () => {
  it("names the device's params as its package does, and finds a knob's", async () => {
    const { track, device } = await started();
    const names = device.paramNames();
    expect(names[0]).toMatch(/^instrument\./);
    expect(device.nameOf(track.params, "filter.cutoff")).toBe("instrument.filter.cutoff");
  });

  it("sets the param a host's macro moves, and doesn't send it back", async () => {
    const { track, sent, device } = await started();
    const spec = track.params.spec("filter.cutoff");
    sent.length = 0;
    device.fromHost("instrument.filter.cutoff", positionOf(spec, 500)!);
    expect(track.params.get("filter.cutoff")).toBeCloseTo(500);
    expect(sent.filter((message) => message.type === "value")).toEqual([]);
    // A knob the window moves itself still goes to the plugin.
    track.params.set("filter.cutoff", 800);
    expect(sent.filter((message) => message.type === "value")).toHaveLength(1);
  });
});
